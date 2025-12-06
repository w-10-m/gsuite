import { GoogleGmailClient } from '../clients/google-gmail-client.js';
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { Logger } from '../services/logger.js';
import { RequestContext } from '../services/request-tracker.js';
import { ProgressReporter } from '../services/progress-reporter.js';

export interface GoogleGmailToolsConfig {
  gOOGLEOAUTHCREDENTIALS?: string;
  scopes?: any;
  authToken?: string;
  logger?: Logger;
}

export class GoogleGmailTools {
  private client: GoogleGmailClient;
  private initialized = false;
  private logger: Logger;

  constructor(client: GoogleGmailClient) {
    this.client = client;
    
    // Get logger from client if available, otherwise create fallback
    this.logger = (client as any).logger || new Logger(
      {
        logLevel: 'ERROR',
        component: 'tools',
        enableConsole: true,
        enableShipping: false,
        serverName: ''
      }
    );
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      // Log tools initialization now that client is ready
      this.logger.info('TOOLS_INIT', 'Tools instance initialization started', { 
        integration: 'google-gmail',
        isOAuth: true
      });
      
      this.logger.info('CLIENT_INITIALIZATION', 'Starting client initialization', {
        isOAuth: true
      });
      
      await this.client.initialize();
      
      this.initialized = true;
      this.logger.info('CLIENT_INITIALIZATION', 'Client initialization completed', {
        initialized: this.initialized
      });
    }
  }

  getToolDefinitions(): Tool[] {
    return [
      {
        name: 'google-gmail_list_messages',
        description: 'List messages in user&#x27;s mailbox with optional filtering',
        inputSchema: {
          type: 'object',
          properties: {
            userId: {
              type: 'string',
              description: 'User&#x27;s email address or &#x27;me&#x27; for authenticated user'
            },
            q: {
              type: 'string',
              description: 'Gmail search query (e.g., &#x27;from:user@example.com subject:important&#x27;)'
            },
            labelIds: {
              type: 'string',
              description: 'Comma-separated list of label IDs to filter by'
            },
            maxResults: {
              type: 'number',
              description: 'Maximum number of messages to return (1-500, default 100)'
            },
            pageToken: {
              type: 'string',
              description: 'Page token for pagination'
            },
            includeSpamTrash: {
              type: 'boolean',
              description: 'Include messages from SPAM and TRASH'
            }
          },
          required: []
        }
      },
      {
        name: 'google-gmail_get_message',
        description: 'Get a specific message by ID',
        inputSchema: {
          type: 'object',
          properties: {
            userId: {
              type: 'string',
              description: 'User&#x27;s email address or &#x27;me&#x27; for authenticated user'
            },
            id: {
              type: 'string',
              description: 'Message ID to retrieve'
            },
            format: {
              type: 'string',
              description: 'Format of message (full, metadata, minimal, raw)'
            },
            metadataHeaders: {
              type: 'string',
              description: 'Comma-separated list of header names to include when format&#x3D;metadata'
            }
          },
          required: ['id']
        }
      },
      {
        name: 'google-gmail_send_message',
        description: 'Send an email message. Requires message in RFC 2822 format encoded as base64url string',
        inputSchema: {
          type: 'object',
          properties: {
            userId: {
              type: 'string',
              description: 'User&#x27;s email address or &#x27;me&#x27; for authenticated user'
            },
            raw: {
              type: 'string',
              description: 'RFC 2822 formatted and base64url encoded email message'
            }
          },
          required: ['raw']
        }
      },
      {
        name: 'google-gmail_create_draft',
        description: 'Create a new draft message. IMPORTANT: Message must be an object with &#x27;raw&#x27; field containing base64url-encoded RFC 2822 formatted message.',
        inputSchema: {
          type: 'object',
          properties: {
            userId: {
              type: 'string',
              description: 'User&#x27;s email address or &#x27;me&#x27; for authenticated user'
            },
            message: {
              type: 'object',
              description: 'Message object containing draft content'
            }
          },
          required: ['message']
        }
      },
      {
        name: 'google-gmail_delete_message',
        description: 'PERMANENTLY delete a message - IMMEDIATE and IRREVERSIBLE. WARNING: Use trash_message instead for normal email deletion. Only use this for sensitive data that must be immediately destroyed. Bypasses trash completely. REQUIRES https://mail.google.com/ scope. Returns 204 No Content with empty body on success.',
        inputSchema: {
          type: 'object',
          properties: {
            userId: {
              type: 'string',
              description: 'User&#x27;s email address or &#x27;me&#x27; for authenticated user'
            },
            id: {
              type: 'string',
              description: 'Message ID to PERMANENTLY DELETE (immediate and irreversible)'
            }
          },
          required: ['id']
        }
      },
      {
        name: 'google-gmail_modify_message',
        description: 'Modify labels on a message (add/remove labels, mark read/unread)',
        inputSchema: {
          type: 'object',
          properties: {
            userId: {
              type: 'string',
              description: 'User&#x27;s email address or &#x27;me&#x27; for authenticated user'
            },
            id: {
              type: 'string',
              description: 'Message ID to modify'
            },
            addLabelIds: {
              type: 'string',
              description: 'Comma-separated list of label IDs to add'
            },
            removeLabelIds: {
              type: 'string',
              description: 'Comma-separated list of label IDs to remove'
            }
          },
          required: ['id']
        }
      },
      {
        name: 'google-gmail_search_messages',
        description: 'search_messages endpoint for google-gmail',
        inputSchema: {
          type: 'object',
          properties: {
          },
          required: []
        }
      }
    ];
  }

  canHandle(toolName: string): boolean {
    const supportedTools: string[] = [
      'google-gmail_list_messages',
      'google-gmail_get_message',
      'google-gmail_send_message',
      'google-gmail_create_draft',
      'google-gmail_delete_message',
      'google-gmail_modify_message',
      'google-gmail_search_messages'
    ];
    return supportedTools.includes(toolName);
  }

  async executeTool(name: string, args: any, context?: RequestContext, progressReporter?: ProgressReporter): Promise<any> {
    const startTime = Date.now();
    
    this.logger.logToolStart(name, args);
    
    // Check for early cancellation
    if (context?.abortController.signal.aborted) {
      this.logger.info('TOOL_CANCELLED_EARLY', 'Tool execution cancelled before start', {
        tool: name,
        requestId: context.requestId
      });
      throw new Error('Request was cancelled');
    }
    
    await this.ensureInitialized();
    
    // Validate tool is supported
    if (!this.canHandle(name)) {
      this.logger.error('TOOL_ERROR', 'Unknown tool requested', {
        tool: name,
        supportedTools: ['google-gmail_list_messages', 'google-gmail_get_message', 'google-gmail_send_message', 'google-gmail_create_draft', 'google-gmail_delete_message', 'google-gmail_modify_message', 'google-gmail_search_messages']
      });
      throw new Error(`Unknown tool: ${name}`);
    }
    
    // Validate required parameters
    this.logger.debug('PARAM_VALIDATION', 'Validating tool parameters', {
      tool: name,
      providedArgs: Object.keys(args || {})
    });
    
    try {
      let result;
      
      // Create request options with cancellation and progress support
      const requestOptions = {
        signal: context?.abortController.signal,
        onProgress: context?.progressToken && progressReporter ? 
          progressReporter.createProgressCallback(context.progressToken) : 
          undefined
      };
      
      switch (name) {
        case 'google-gmail_list_messages':
          this.logger.debug('TOOL_EXECUTE', 'Calling client method', {
            tool: 'google-gmail_list_messages',
            clientMethod: 'listMessages',
            hasAbortSignal: !!requestOptions.signal,
            hasProgressCallback: !!requestOptions.onProgress
          });
          
          // Report initial progress
          if (context?.progressToken && progressReporter) {
            await progressReporter.report(context.progressToken, {
              progress: 0,
              total: 100,
              message: `Starting list_messages operation...`
            });
          }
          
          result = await this.client.listMessages(args, requestOptions);
          
          // Report completion
          if (context?.progressToken && progressReporter) {
            await progressReporter.report(context.progressToken, {
              progress: 100,
              total: 100,
              message: `Completed list_messages operation`
            });
          }
          break;
        case 'google-gmail_get_message':
          this.logger.debug('TOOL_EXECUTE', 'Calling client method', {
            tool: 'google-gmail_get_message',
            clientMethod: 'getMessage',
            hasAbortSignal: !!requestOptions.signal,
            hasProgressCallback: !!requestOptions.onProgress
          });
          
          // Report initial progress
          if (context?.progressToken && progressReporter) {
            await progressReporter.report(context.progressToken, {
              progress: 0,
              total: 100,
              message: `Starting get_message operation...`
            });
          }
          
          result = await this.client.getMessage(args, requestOptions);
          
          // Report completion
          if (context?.progressToken && progressReporter) {
            await progressReporter.report(context.progressToken, {
              progress: 100,
              total: 100,
              message: `Completed get_message operation`
            });
          }
          break;
        case 'google-gmail_send_message':
          this.logger.debug('TOOL_EXECUTE', 'Calling client method', {
            tool: 'google-gmail_send_message',
            clientMethod: 'sendMessage',
            hasAbortSignal: !!requestOptions.signal,
            hasProgressCallback: !!requestOptions.onProgress
          });
          
          // Report initial progress
          if (context?.progressToken && progressReporter) {
            await progressReporter.report(context.progressToken, {
              progress: 0,
              total: 100,
              message: `Starting send_message operation...`
            });
          }
          
          result = await this.client.sendMessage(args, requestOptions);
          
          // Report completion
          if (context?.progressToken && progressReporter) {
            await progressReporter.report(context.progressToken, {
              progress: 100,
              total: 100,
              message: `Completed send_message operation`
            });
          }
          break;
        case 'google-gmail_create_draft':
          this.logger.debug('TOOL_EXECUTE', 'Calling client method', {
            tool: 'google-gmail_create_draft',
            clientMethod: 'createDraft',
            hasAbortSignal: !!requestOptions.signal,
            hasProgressCallback: !!requestOptions.onProgress
          });
          
          // Report initial progress
          if (context?.progressToken && progressReporter) {
            await progressReporter.report(context.progressToken, {
              progress: 0,
              total: 100,
              message: `Starting create_draft operation...`
            });
          }
          
          result = await this.client.createDraft(args, requestOptions);
          
          // Report completion
          if (context?.progressToken && progressReporter) {
            await progressReporter.report(context.progressToken, {
              progress: 100,
              total: 100,
              message: `Completed create_draft operation`
            });
          }
          break;
        case 'google-gmail_delete_message':
          this.logger.debug('TOOL_EXECUTE', 'Calling client method', {
            tool: 'google-gmail_delete_message',
            clientMethod: 'deleteMessage',
            hasAbortSignal: !!requestOptions.signal,
            hasProgressCallback: !!requestOptions.onProgress
          });
          
          // Report initial progress
          if (context?.progressToken && progressReporter) {
            await progressReporter.report(context.progressToken, {
              progress: 0,
              total: 100,
              message: `Starting delete_message operation...`
            });
          }
          
          result = await this.client.deleteMessage(args, requestOptions);
          
          // Report completion
          if (context?.progressToken && progressReporter) {
            await progressReporter.report(context.progressToken, {
              progress: 100,
              total: 100,
              message: `Completed delete_message operation`
            });
          }
          break;
        case 'google-gmail_modify_message':
          this.logger.debug('TOOL_EXECUTE', 'Calling client method', {
            tool: 'google-gmail_modify_message',
            clientMethod: 'modifyMessage',
            hasAbortSignal: !!requestOptions.signal,
            hasProgressCallback: !!requestOptions.onProgress
          });
          
          // Report initial progress
          if (context?.progressToken && progressReporter) {
            await progressReporter.report(context.progressToken, {
              progress: 0,
              total: 100,
              message: `Starting modify_message operation...`
            });
          }
          
          result = await this.client.modifyMessage(args, requestOptions);
          
          // Report completion
          if (context?.progressToken && progressReporter) {
            await progressReporter.report(context.progressToken, {
              progress: 100,
              total: 100,
              message: `Completed modify_message operation`
            });
          }
          break;
        case 'google-gmail_search_messages':
          this.logger.debug('TOOL_EXECUTE', 'Calling client method', {
            tool: 'google-gmail_search_messages',
            clientMethod: 'searchMessages',
            hasAbortSignal: !!requestOptions.signal,
            hasProgressCallback: !!requestOptions.onProgress
          });
          
          // Report initial progress
          if (context?.progressToken && progressReporter) {
            await progressReporter.report(context.progressToken, {
              progress: 0,
              total: 100,
              message: `Starting search_messages operation...`
            });
          }
          
          result = await this.client.searchMessages(args, requestOptions);
          
          // Report completion
          if (context?.progressToken && progressReporter) {
            await progressReporter.report(context.progressToken, {
              progress: 100,
              total: 100,
              message: `Completed search_messages operation`
            });
          }
          break;
        default:
          throw new Error(`Unknown tool: ${name}`);
      }

      const duration = Date.now() - startTime;
      this.logger.logToolSuccess(name, duration, result);

      // Format the result for MCP (OAuth templates only)
      return {
        content: [
          {
            type: 'text',
            text: typeof result === 'string' ? result : JSON.stringify(result, null, 2)
          }
        ]
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      // Check if error is due to cancellation
      const isCancelled = context?.abortController.signal.aborted || 
                         (error instanceof Error && error.message === 'Request was cancelled');
      
      if (isCancelled) {
        this.logger.info('TOOL_CANCELLED', 'Tool execution cancelled', {
          tool: name,
          duration_ms: duration,
          requestId: context?.requestId
        });
      } else {
        this.logger.logToolError(name, error, duration, args);
      }
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${errorMessage}`
          }
        ],
        isError: true
      };
    }
  }
}