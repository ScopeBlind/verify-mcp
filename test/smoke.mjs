import process from 'node:process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const client = new Client({ name: 'verify-mcp-smoke', version: '0.1.0' });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['server.js'],
  cwd: new URL('..', import.meta.url).pathname,
  stderr: 'pipe',
});

transport.stderr?.on('data', (chunk) => {
  process.stderr.write(chunk);
});

try {
  await client.connect(transport);
  const tools = await client.listTools();
  const names = tools.tools.map((tool) => tool.name).sort();
  const expected = ['explain_artifact', 'self_test', 'verify_bundle', 'verify_receipt'];
  if (JSON.stringify(names) !== JSON.stringify(expected)) {
    throw new Error(`Unexpected tools: ${JSON.stringify(names)}`);
  }

  const selfTest = await client.callTool({ name: 'self_test', arguments: {} });
  const payload = JSON.parse(selfTest.content?.[0]?.text || '{}');
  if (!payload.ok || !payload.bundle?.valid || !payload.receipt?.valid) {
    throw new Error(`Self-test failed: ${JSON.stringify(payload)}`);
  }

  console.log('verify-mcp smoke: PASS');
  await transport.close();
} catch (error) {
  console.error(error);
  process.exit(1);
}
