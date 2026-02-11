import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const UUID = Deno.env.get("UUID") || "f9a1ba12-7187-4b25-a5d5-7bafd82ffb4d";
const DOMAIN = Deno.env.get("DOMAIN") || "rnd-q5ot.onrender.com";
const WS_PATH = Deno.env.get("WS_PATH") || "ws";
const SUB_PATH = Deno.env.get("SUB_PATH") || "sub";
const PORT = parseInt(Deno.env.get("PORT") || "10000");

// ---------------- UUID UTILS ----------------

function parseUUID(uuid: string): Uint8Array {
  uuid = uuid.replace(/-/g, "");
  const arr = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    arr[i] = parseInt(uuid.slice(i * 2, i * 2 + 2), 16);
  }
  return arr;
}

function equalUUID(a: Uint8Array, b: Uint8Array): boolean {
  for (let i = 0; i < 16; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// ---------------- VLESS PARSER ----------------

async function parseVLESS(buffer: Uint8Array) {
  const version = buffer[0];
  const id = buffer.slice(1, 17);

  if (!equalUUID(id, parseUUID(UUID))) {
    throw new Error("Invalid UUID");
  }

  const optLen = buffer[17];
  const cmd = buffer[18 + optLen];
  if (cmd !== 1) throw new Error("Only TCP supported");

  const portIndex = 19 + optLen;
  const port = (buffer[portIndex] << 8) + buffer[portIndex + 1];
  const addrType = buffer[portIndex + 2];

  let host = "";
  let index = portIndex + 3;

  if (addrType === 1) {
    host = `${buffer[index]}.${buffer[index + 1]}.${buffer[index + 2]}.${buffer[index + 3]}`;
    index += 4;
  } else if (addrType === 2) {
    const len = buffer[index];
    index++;
    host = new TextDecoder().decode(buffer.slice(index, index + len));
    index += len;
  } else if (addrType === 3) {
    const parts = [];
    for (let i = 0; i < 8; i++) {
      parts.push(
        ((buffer[index + i * 2] << 8) + buffer[index + i * 2 + 1]).toString(16)
      );
    }
    host = parts.join(":");
    index += 16;
  }

  const rest = buffer.slice(index);

  return { version, host, port, rest };
}

// ---------------- WS HANDLER ----------------

async function handleWS(req: Request): Promise<Response> {
  const { socket, response } = Deno.upgradeWebSocket(req);

  let remote: Deno.Conn | null = null;

  socket.onmessage = async (event) => {
    try {
      const data = new Uint8Array(event.data);

      if (!remote) {
        const vless = await parseVLESS(data);

        remote = await Deno.connect({
          hostname: vless.host,
          port: vless.port,
        });

        // send VLESS response
        socket.send(new Uint8Array([vless.version, 0]));

        if (vless.rest.length > 0) {
          await remote.write(vless.rest);
        }

        // Remote → WS
        (async () => {
          const buf = new Uint8Array(4096);
          while (true) {
            const n = await remote!.read(buf);
            if (!n) break;
            socket.send(buf.slice(0, n));
          }
          socket.close();
          remote?.close();
        })();

      } else {
        await remote.write(data);
      }
    } catch {
      socket.close();
      remote?.close();
    }
  };

  socket.onclose = () => {
    remote?.close();
  };

  return response;
}

// ---------------- SERVER ----------------

serve(async (req: Request) => {
  const url = new URL(req.url);

  if (url.pathname === "/") {
    return new Response("Render VLESS WS Running\n");
  }

  if (url.pathname === `/${SUB_PATH}`) {
    const vless =
      `vless://${UUID}@${DOMAIN}:443` +
      `?encryption=none` +
      `&security=tls` +
      `&type=ws` +
      `&host=${DOMAIN}` +
      `&path=/${WS_PATH}` +
      `&sni=${DOMAIN}` +
      `#Render-WS`;

    return new Response(btoa(vless), {
      headers: { "Content-Type": "text/plain" },
    });
  }

  if (url.pathname === `/${WS_PATH}`) {
    if (req.headers.get("upgrade") !== "websocket") {
      return new Response("Expected WebSocket", { status: 400 });
    }
    return handleWS(req);
  }

  return new Response("Not Found", { status: 404 });
}, { port: PORT });

console.log(`Server running on port ${PORT}`);
