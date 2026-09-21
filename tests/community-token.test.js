/**
 * A community token reaches only a slice of the VK API. These start the real
 * server against a stand-in VK that answers like a community token, and check
 * that the model is shown only the tools that slice can call.
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'index.js');
const COMMUNITY = { id: 191826073, name: 'Тестовое сообщество', screen_name: 'club191826073' };

const RESPONSES = {
  'groups.getTokenPermissions': { mask: 4, permissions: [{ name: 'wall', setting: 8192 }, { name: 'messages', setting: 4096 }] },
  'groups.getById': { groups: [COMMUNITY] },
  'messages.send': 42,
};

let vkStub;
let client;
const calls = [];

beforeAll(async () => {
  vkStub = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      const method = req.url.split('/').pop();
      calls.push({ method, params: Object.fromEntries(new URLSearchParams(body)) });
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ response: RESPONSES[method] ?? {} }));
    });
  });
  await new Promise((resolve) => vkStub.listen(0, '127.0.0.1', resolve));

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER],
    env: {
      ...process.env,
      VK_ACCESS_TOKEN: 'community_token_not_real',
      VK_API_BASE: `http://127.0.0.1:${vkStub.address().port}`,
    },
  });
  client = new Client({ name: 'vk-mcp-community-tests', version: '1.0.0' }, { capabilities: {} });
  await client.connect(transport);
}, 30000);

afterAll(async () => {
  await client?.close();
  await new Promise((resolve) => vkStub.close(resolve));
});

describe('community token', () => {
  it('lists only the tools a community token can call', async () => {
    const names = (await client.listTools()).tools.map((tool) => tool.name).sort();
    expect(names).toEqual([
      'vk_groups_get_by_id',
      'vk_groups_get_members',
      'vk_messages_get_conversations',
      'vk_messages_get_history',
      'vk_messages_send',
      'vk_token_info',
      'vk_users_get',
      'vk_wall_post',
    ]);
  });

  it('names the community and its scopes', async () => {
    const res = await client.callTool({ name: 'vk_token_info', arguments: {} });
    expect(res.structuredContent).toMatchObject({
      kind: 'community',
      community: { id: COMMUNITY.id, owner_id: -COMMUNITY.id },
      scopes: ['wall', 'messages'],
    });
  });

  it('replies as the community without asking for its ID', async () => {
    await client.callTool({ name: 'vk_messages_send', arguments: { peer_id: 1, message: 'Здравствуйте' } });
    const send = calls.find((call) => call.method === 'messages.send');
    expect(send.params).toMatchObject({ group_id: String(COMMUNITY.id), peer_id: '1', message: 'Здравствуйте' });
    expect(send.params.random_id).toEqual(expect.any(String));
  });
});
