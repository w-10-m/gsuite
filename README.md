# gsuite-mcp

[![npm version](https://img.shields.io/npm/v/@west10tech/gsuite-mcp.svg)](https://www.npmjs.com/package/@west10tech/gsuite-mcp)
[![Coverage](https://img.shields.io/endpoint?url=https://gist.githubusercontent.com/gcaliene/c900729d15553491a34b397832b745c7/raw/coverage.json)]()

Comprehensive Google Workspace MCP server with Gmail, Drive, Calendar, and Contacts integration

**npm:** https://www.npmjs.com/package/@west10tech/gsuite-mcp

This MCP server includes the following integrations:

## Available Tools

This MCP server provides 26 tools across 4 integrations:

### GoogleGmail Tools
- **google-gmail_list_messages**: List messages in user&#x27;s mailbox with optional filtering
- **google-gmail_get_message**: Get a specific message by ID
- **google-gmail_send_message**: Send an email message. Requires message in RFC 2822 format encoded as base64url string
- **google-gmail_create_draft**: Create a new draft message. IMPORTANT: Message must be an object with &#x27;raw&#x27; field containing base64url-encoded RFC 2822 formatted message.
- **google-gmail_delete_message**: PERMANENTLY delete a message - IMMEDIATE and IRREVERSIBLE. WARNING: Use trash_message instead for normal email deletion. Only use this for sensitive data that must be immediately destroyed. Bypasses trash completely. REQUIRES https://mail.google.com/ scope. Returns 204 No Content with empty body on success.
- **google-gmail_modify_message**: Modify labels on a message (add/remove labels, mark read/unread)
- **google-gmail_search_messages**: search_messages endpoint for google-gmail
### GoogleDrive Tools
- **google-drive_list_files**: List files in Google Drive with optional search query and filtering
- **google-drive_get_file**: Get file metadata by ID
- **google-drive_update_file**: Update file metadata
- **google-drive_delete_file**: Permanently delete a file. Returns 204 No Content with empty body on success.
- **google-drive_search_files**: Advanced file search with complex query syntax
- **google-drive_create_file**: create_file endpoint for google-drive
- **google-drive_share_file**: share_file endpoint for google-drive
### GoogleCalendar Tools
- **google-calendar_list_events**: Returns events on the specified calendar
- **google-calendar_get_event**: Returns an event
- **google-calendar_create_event**: Creates an event
- **google-calendar_update_event**: Updates an event
- **google-calendar_delete_event**: Deletes an event. Returns 204 No Content with empty body on success.
- **google-calendar_list_calendars**: Returns the calendars on the user&#x27;s calendar list
### GoogleContacts Tools
- **google-contacts_create_contact**: Create a new contact with specified fields
- **google-contacts_update_contact**: Update an existing contact. IMPORTANT: Include the &#x27;etag&#x27; field in the request body to prevent conflicts. Get the current etag by first calling get_contact or from a previous create/update response.
- **google-contacts_delete_contact**: Delete a contact permanently
- **google-contacts_search_contacts**: Search across all contacts with text query
- **google-contacts_list_contacts**: list_contacts endpoint for google-contacts
- **google-contacts_get_contact**: get_contact endpoint for google-contacts

## Installation

```bash
npm install @west10tech/gsuite-mcp
```

## Environment Setup

Create a `.env` file with the following variables:

```env
GOOGLE_CLIENT_ID=your_google_client_id_here
GOOGLE_CLIENT_SECRET=your_google_client_secret_here
GOOGLE_OAUTH_CREDENTIALS=your_google_oauth_credentials_here
GOOGLE_REDIRECT_URI=your_google_redirect_uri_here
```

## Usage

### Running the server

```bash
# Development mode
npm run dev

# Production mode
npm run build && npm start
```

### Using with Claude Desktop

Add this to your Claude Desktop configuration:

```json
{
  "mcpServers": {
    "gsuite": {
      "command": "npx",
      "args": ["@west10tech/gsuite-mcp"],
      "env": {
        "GOOGLE_CLIENT_ID": "your_google_client_id_here",
        "GOOGLE_CLIENT_SECRET": "your_google_client_secret_here",
        "GOOGLE_OAUTH_CREDENTIALS": "your_google_oauth_credentials_here",
        "GOOGLE_REDIRECT_URI": "your_google_redirect_uri_here"
      }
    }
  }
}
```

## Instructions for Fetching API Keys/Tokens
- **COMING SOON**

## Advanced Features

### Request Cancellation

This MCP server supports request cancellation according to the [MCP cancellation specification](https://modelcontextprotocol.io/specification/2025-06-18/basic/utilities/cancellation). Clients can cancel in-progress requests by sending a `notifications/cancelled` message with the request ID.

When a request is cancelled:
- The server immediately stops processing the request
- Any ongoing API calls are aborted
- Resources are cleaned up
- No response is sent for the cancelled request

### Progress Notifications

The server supports progress notifications for long-running operations according to the [MCP progress specification](https://modelcontextprotocol.io/specification/2025-06-18/basic/utilities/progress). 

To receive progress updates:
1. Include a `progressToken` in your request metadata
2. The server will send `notifications/progress` messages with:
   - Current progress value
   - Total value (when known)
   - Human-readable status messages

Progress is reported for:
- Multi-step operations
- Batch processing
- Long-running API calls
- File uploads/downloads

Example progress notification:
```json
{
  "method": "notifications/progress",
  "params": {
    "progressToken": "operation-123",
    "progress": 45,
    "total": 100,
    "message": "Processing item 45 of 100..."
  }
}
```

