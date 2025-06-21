import { spawn } from "child_process";
import * as readline from "readline/promises";
import { intro, isCancel, select, text } from "@clack/prompts";

type Tool = {
  name: string;
  description: string;
  inputSchema: {
    properties: Record<string, any>;
  };
};

type Resource = {
  uri: string;
  name: string;
};

type Content = {
  text: string;
};

async function main() {
  const serverProcess = spawn("bun", ["../server/dist/index.js"], {
    stdio: ["pipe", "pipe", "inherit"],
  });

  // const serverProcess = spawn("uvx", ["mcp-server-fetch"], {
  //   stdio: ["pipe", "pipe", "inherit"],
  // });

  const rl = readline.createInterface({
    input: serverProcess.stdout,
    output: undefined,
  });

  let globalId = 0;

  async function send(
    method: string,
    params: object = {},
    isNotification?: boolean,
  ) {
    serverProcess.stdin.write(
      JSON.stringify({
        jsonrpc: "2.0",
        method,
        params,
        id: isNotification ? undefined : ++globalId,
      }) + "\n",
    );

    if (isNotification) {
      return;
    }

    const json = await rl.question("");

    return JSON.parse(json).result;
  }

  function dumpContent(content: { text: string }[]) {
    for (const line of content) {
      try {
        console.log(JSON.parse(line.text));
      } catch {
        console.log(line.text);
      }
    }
  }

  const {
    serverInfo,
    capabilities,
  }: {
    serverInfo: { name: string; version: string };
    capabilities: {
      tools?: any;
      resources?: any;
    };
  } = await send("initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: {
      name: "custom-mcp-client",
      version: "1.0.0",
    },
  });

  await send("notifications/initialized", {}, true);

  const tools = capabilities.tools
    ? ((await send("tools/list", { _meta: { progressToken: 1 } }))
        .tools as Tool[])
    : [];

  const resources = capabilities.resources
    ? ((await send("resources/list", { _meta: { progressToken: 1 } }))
        .resources as Resource[])
    : [];

  intro(`Connecting to ${serverInfo.name} v${serverInfo.version}`);

  while (true) {
    const options = [];

    if (resources.length > 0) {
      options.unshift({
        value: "resource",
        label: "Get a resource",
      });
    }

    if (tools.length > 0) {
      options.unshift({
        value: "tool",
        label: "Get a tool",
      });
    }

    options.unshift({
      value: "ping",
      label: "Ping the server",
    });

    const action = await select({
      message: "What do you want to do?",
      options,
    });

    if (isCancel(action)) {
      process.exit(0);
    }

    if (action === "ping") {
      const res = await send("ping");

      console.log(res);
    } else if (action === "tool") {
      const tool = await select({
        message: "Select a tool",
        options: tools.map((tool) => ({
          value: tool,
          label: tool.name,
        })),
      });

      if (isCancel(tool)) {
        process.exit(0);
      }

      const args: Record<string, any> = {};

      for (const [key, value] of Object.entries(tool.inputSchema.properties)) {
        if (value.type === "string") {
          const input = await text({
            message: `Enter value for ${key} (${value.type})`,
            initialValue: "",
          });

          if (isCancel(input)) {
            process.exit(0);
          }

          args[key] = input;
        }
      }

      const { content } = await send("tools/call", {
        name: tool.name,
        arguments: args,
      });

      dumpContent(content);
    } else if (action === "resource") {
      const resource = await select({
        message: "Select a resource",
        options: resources.map((resource) => ({
          value: resource,
          label: resource.name,
        })),
      });

      if (isCancel(resource)) {
        process.exit(0);
      }

      const { contents }: { contents: Content[] } = await send(
        "resources/read",
        {
          uri: resource.uri,
        },
      );

      dumpContent(contents);
    }
  }
}

main();
