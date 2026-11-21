import { createNrouterEngine } from "./server.ts";

const port = Number(process.env.PORT ?? 8124);
const server = createNrouterEngine();
server.listen(port, () => {
  console.log(`agent-nrouter AG-UI harness listening on :${port}`);
});
