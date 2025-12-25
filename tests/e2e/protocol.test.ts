import { McpTestClient } from './helpers/mcp-client';

describe('JSON-RPC Protocol', () => {
  let client: McpTestClient;

  beforeEach(async () => {
    client = new McpTestClient();
    await client.start();
  });

  afterEach(async () => {
    await client.stop();
  });

  describe('request/response', () => {
    it('returns tools/list with all tools', async () => {
      const tools = await client.listTools();
      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThan(0);
    });

    it('returns error for unknown method', async () => {
      await expect(client.request('unknown/method')).rejects.toThrow();
    });

    it('includes Google Calendar tools', async () => {
      const tools = await client.listTools();
      const toolNames = tools.map(t => t.name);
      expect(toolNames).toContain('google-calendar_create_event');
      expect(toolNames).toContain('google-calendar_list_events');
      expect(toolNames).toContain('google-calendar_get_event');
    });

    it('includes Google Drive tools', async () => {
      const tools = await client.listTools();
      const toolNames = tools.map(t => t.name);
      expect(toolNames).toContain('google-drive_list_files');
      expect(toolNames).toContain('google-drive_create_file');
      expect(toolNames).toContain('google-drive_search_files');
    });

    it('includes Google Gmail tools', async () => {
      const tools = await client.listTools();
      const toolNames = tools.map(t => t.name);
      expect(toolNames).toContain('google-gmail_list_messages');
      expect(toolNames).toContain('google-gmail_send_message');
    });
  });

  describe('error handling', () => {
    it('returns error for non-existent tool', async () => {
      await expect(client.callTool('non_existent_tool', {})).rejects.toThrow();
    });

    it('returns API error when credentials are invalid', async () => {
      await expect(client.callTool('google-drive_list_files', {})).rejects.toThrow();
    });
  });

  describe('notifications', () => {
    it('can send notifications', () => {
      expect(() => {
        client.sendNotification('notifications/initialized', {});
      }).not.toThrow();
    });

    it('can send cancellation notification', () => {
      expect(() => {
        client.sendCancellation('request-123', 'User cancelled');
      }).not.toThrow();
    });
  });

  describe('tool schema validation', () => {
    it('each tool has required schema properties', async () => {
      const tools = await client.listTools();
      for (const tool of tools) {
        expect(tool.name).toBeDefined();
        expect(typeof tool.name).toBe('string');
        expect(tool.description).toBeDefined();
        expect(typeof tool.description).toBe('string');
        expect(tool.inputSchema).toBeDefined();
        expect(tool.inputSchema.type).toBe('object');
      }
    });
  });
});
