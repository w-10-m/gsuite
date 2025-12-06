import { GoogleDriveClient } from '../clients/google-drive-client.js';
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { Logger } from '../services/logger.js';
import { RequestContext } from '../services/request-tracker.js';
import { ProgressReporter } from '../services/progress-reporter.js';

export interface GoogleDriveToolsConfig {
  gOOGLEOAUTHCREDENTIALS?: string;
  scopes?: any;
  authToken?: string;
  logger?: Logger;
}

export class GoogleDriveTools {
  private client: GoogleDriveClient;
  private initialized = false;
  private logger: Logger;

  constructor(client: GoogleDriveClient) {
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
        integration: 'google-drive',
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
        name: 'google-drive_list_files',
        description: 'List files in Google Drive with optional search query and filtering',
        inputSchema: {
          type: 'object',
          properties: {
            q: {
              type: 'string',
              description: 'Search query using Drive query syntax (e.g., &#x27;name contains &quot;test&quot;&#x27;, &#x27;mimeType&#x3D;&quot;application/pdf&quot;&#x27;, &#x27;parents in &quot;folderId&quot;&#x27;)'
            },
            pageSize: {
              type: 'number',
              description: 'Maximum number of files to return (default 100, max 1000)'
            },
            pageToken: {
              type: 'string',
              description: 'Page token for pagination'
            },
            fields: {
              type: 'string',
              description: 'Fields to return - IMPORTANT: Must use format &#x27;files(id,name,mimeType,size,modifiedTime,parents,webViewLink)&#x27; for list endpoints. Do NOT use &#x27;id,name,mimeType&#x27; format.'
            },
            orderBy: {
              type: 'string',
              description: 'Sort order: &#x27;createdTime&#x27;, &#x27;folder&#x27;, &#x27;modifiedByMeTime&#x27;, &#x27;modifiedTime&#x27;, &#x27;name&#x27;, &#x27;quotaBytesUsed&#x27;, &#x27;recency&#x27;, &#x27;sharedWithMeTime&#x27;, &#x27;starred&#x27;, &#x27;viewedByMeTime&#x27;'
            },
            spaces: {
              type: 'string',
              description: 'Comma-separated list of spaces to query: &#x27;drive&#x27;, &#x27;appDataFolder&#x27;, &#x27;photos&#x27;'
            },
            corpora: {
              type: 'string',
              description: 'Corpora to search: &#x27;user&#x27; (default), &#x27;domain&#x27;, &#x27;drive&#x27;, &#x27;allDrives&#x27;'
            },
            driveId: {
              type: 'string',
              description: 'ID of the shared drive to search (if corpora is &#x27;drive&#x27;)'
            },
            includeItemsFromAllDrives: {
              type: 'boolean',
              description: 'Whether to include files from all drives'
            },
            supportsAllDrives: {
              type: 'boolean',
              description: 'Whether to support files in shared drives'
            },
            includePermissionsForView: {
              type: 'string',
              description: 'Specifies which additional view&#x27;s permissions to include (&#x27;published&#x27;)'
            },
            includeLabels: {
              type: 'string',
              description: 'Comma-separated list of label IDs to include'
            }
          },
          required: []
        }
      },
      {
        name: 'google-drive_get_file',
        description: 'Get file metadata by ID',
        inputSchema: {
          type: 'object',
          properties: {
            fileId: {
              type: 'string',
              description: 'ID of the file to retrieve'
            },
            fields: {
              type: 'string',
              description: 'Comma-separated list of fields to return (e.g., &#x27;id,name,mimeType,size,parents,modifiedTime,createdTime,webViewLink&#x27;). For single items, use direct field names.'
            },
            supportsAllDrives: {
              type: 'boolean',
              description: 'Whether to support files in shared drives'
            },
            acknowledgeAbuse: {
              type: 'boolean',
              description: 'Whether to acknowledge virus scan warnings'
            }
          },
          required: ['fileId']
        }
      },
      {
        name: 'google-drive_update_file',
        description: 'Update file metadata',
        inputSchema: {
          type: 'object',
          properties: {
            fileId: {
              type: 'string',
              description: 'ID of the file to update'
            },
            fields: {
              type: 'string',
              description: 'Comma-separated list of fields to return in response'
            },
            supportsAllDrives: {
              type: 'boolean',
              description: 'Whether to support files in shared drives'
            },
            name: {
              type: 'string',
              description: 'New name for the file'
            },
            description: {
              type: 'string',
              description: 'New description for the file'
            },
            parents: {
              type: 'object',
              description: 'Array of parent folder IDs'
            },
            starred: {
              type: 'boolean',
              description: 'Whether to star the file'
            },
            trashed: {
              type: 'boolean',
              description: 'Whether to move the file to trash'
            }
          },
          required: ['fileId']
        }
      },
      {
        name: 'google-drive_delete_file',
        description: 'Permanently delete a file. Returns 204 No Content with empty body on success.',
        inputSchema: {
          type: 'object',
          properties: {
            fileId: {
              type: 'string',
              description: 'ID of the file to delete'
            },
            supportsAllDrives: {
              type: 'boolean',
              description: 'Whether to support files in shared drives'
            }
          },
          required: ['fileId']
        }
      },
      {
        name: 'google-drive_search_files',
        description: 'Advanced file search with complex query syntax',
        inputSchema: {
          type: 'object',
          properties: {
            q: {
              type: 'string',
              description: 'Advanced search query (e.g., &#x27;fullText contains &quot;keyword&quot; and mimeType contains &quot;google-apps&quot;&#x27;)'
            },
            pageSize: {
              type: 'number',
              description: 'Maximum number of results to return'
            },
            pageToken: {
              type: 'string',
              description: 'Page token for pagination'
            },
            fields: {
              type: 'string',
              description: 'Fields to return - IMPORTANT: Must use format &#x27;files(id,name,mimeType,size,parents,webViewLink)&#x27; for list endpoints. Do NOT use &#x27;id,name,mimeType&#x27; format.'
            },
            orderBy: {
              type: 'string',
              description: 'Sort order for search results'
            },
            includeItemsFromAllDrives: {
              type: 'boolean',
              description: 'Whether to include files from all drives'
            },
            supportsAllDrives: {
              type: 'boolean',
              description: 'Whether to support shared drives'
            }
          },
          required: ['q']
        }
      },
      {
        name: 'google-drive_create_file',
        description: 'create_file endpoint for google-drive',
        inputSchema: {
          type: 'object',
          properties: {
          },
          required: []
        }
      },
      {
        name: 'google-drive_share_file',
        description: 'share_file endpoint for google-drive',
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
      'google-drive_list_files',
      'google-drive_get_file',
      'google-drive_update_file',
      'google-drive_delete_file',
      'google-drive_search_files',
      'google-drive_create_file',
      'google-drive_share_file'
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
        supportedTools: ['google-drive_list_files', 'google-drive_get_file', 'google-drive_update_file', 'google-drive_delete_file', 'google-drive_search_files', 'google-drive_create_file', 'google-drive_share_file']
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
        case 'google-drive_list_files':
          this.logger.debug('TOOL_EXECUTE', 'Calling client method', {
            tool: 'google-drive_list_files',
            clientMethod: 'listFiles',
            hasAbortSignal: !!requestOptions.signal,
            hasProgressCallback: !!requestOptions.onProgress
          });
          
          // Report initial progress
          if (context?.progressToken && progressReporter) {
            await progressReporter.report(context.progressToken, {
              progress: 0,
              total: 100,
              message: `Starting list_files operation...`
            });
          }
          
          result = await this.client.listFiles(args, requestOptions);
          
          // Report completion
          if (context?.progressToken && progressReporter) {
            await progressReporter.report(context.progressToken, {
              progress: 100,
              total: 100,
              message: `Completed list_files operation`
            });
          }
          break;
        case 'google-drive_get_file':
          this.logger.debug('TOOL_EXECUTE', 'Calling client method', {
            tool: 'google-drive_get_file',
            clientMethod: 'getFile',
            hasAbortSignal: !!requestOptions.signal,
            hasProgressCallback: !!requestOptions.onProgress
          });
          
          // Report initial progress
          if (context?.progressToken && progressReporter) {
            await progressReporter.report(context.progressToken, {
              progress: 0,
              total: 100,
              message: `Starting get_file operation...`
            });
          }
          
          result = await this.client.getFile(args, requestOptions);
          
          // Report completion
          if (context?.progressToken && progressReporter) {
            await progressReporter.report(context.progressToken, {
              progress: 100,
              total: 100,
              message: `Completed get_file operation`
            });
          }
          break;
        case 'google-drive_update_file':
          this.logger.debug('TOOL_EXECUTE', 'Calling client method', {
            tool: 'google-drive_update_file',
            clientMethod: 'updateFile',
            hasAbortSignal: !!requestOptions.signal,
            hasProgressCallback: !!requestOptions.onProgress
          });
          
          // Report initial progress
          if (context?.progressToken && progressReporter) {
            await progressReporter.report(context.progressToken, {
              progress: 0,
              total: 100,
              message: `Starting update_file operation...`
            });
          }
          
          result = await this.client.updateFile(args, requestOptions);
          
          // Report completion
          if (context?.progressToken && progressReporter) {
            await progressReporter.report(context.progressToken, {
              progress: 100,
              total: 100,
              message: `Completed update_file operation`
            });
          }
          break;
        case 'google-drive_delete_file':
          this.logger.debug('TOOL_EXECUTE', 'Calling client method', {
            tool: 'google-drive_delete_file',
            clientMethod: 'deleteFile',
            hasAbortSignal: !!requestOptions.signal,
            hasProgressCallback: !!requestOptions.onProgress
          });
          
          // Report initial progress
          if (context?.progressToken && progressReporter) {
            await progressReporter.report(context.progressToken, {
              progress: 0,
              total: 100,
              message: `Starting delete_file operation...`
            });
          }
          
          result = await this.client.deleteFile(args, requestOptions);
          
          // Report completion
          if (context?.progressToken && progressReporter) {
            await progressReporter.report(context.progressToken, {
              progress: 100,
              total: 100,
              message: `Completed delete_file operation`
            });
          }
          break;
        case 'google-drive_search_files':
          this.logger.debug('TOOL_EXECUTE', 'Calling client method', {
            tool: 'google-drive_search_files',
            clientMethod: 'searchFiles',
            hasAbortSignal: !!requestOptions.signal,
            hasProgressCallback: !!requestOptions.onProgress
          });
          
          // Report initial progress
          if (context?.progressToken && progressReporter) {
            await progressReporter.report(context.progressToken, {
              progress: 0,
              total: 100,
              message: `Starting search_files operation...`
            });
          }
          
          result = await this.client.searchFiles(args, requestOptions);
          
          // Report completion
          if (context?.progressToken && progressReporter) {
            await progressReporter.report(context.progressToken, {
              progress: 100,
              total: 100,
              message: `Completed search_files operation`
            });
          }
          break;
        case 'google-drive_create_file':
          this.logger.debug('TOOL_EXECUTE', 'Calling client method', {
            tool: 'google-drive_create_file',
            clientMethod: 'createFile',
            hasAbortSignal: !!requestOptions.signal,
            hasProgressCallback: !!requestOptions.onProgress
          });
          
          // Report initial progress
          if (context?.progressToken && progressReporter) {
            await progressReporter.report(context.progressToken, {
              progress: 0,
              total: 100,
              message: `Starting create_file operation...`
            });
          }
          
          result = await this.client.createFile(args, requestOptions);
          
          // Report completion
          if (context?.progressToken && progressReporter) {
            await progressReporter.report(context.progressToken, {
              progress: 100,
              total: 100,
              message: `Completed create_file operation`
            });
          }
          break;
        case 'google-drive_share_file':
          this.logger.debug('TOOL_EXECUTE', 'Calling client method', {
            tool: 'google-drive_share_file',
            clientMethod: 'shareFile',
            hasAbortSignal: !!requestOptions.signal,
            hasProgressCallback: !!requestOptions.onProgress
          });
          
          // Report initial progress
          if (context?.progressToken && progressReporter) {
            await progressReporter.report(context.progressToken, {
              progress: 0,
              total: 100,
              message: `Starting share_file operation...`
            });
          }
          
          result = await this.client.shareFile(args, requestOptions);
          
          // Report completion
          if (context?.progressToken && progressReporter) {
            await progressReporter.report(context.progressToken, {
              progress: 100,
              total: 100,
              message: `Completed share_file operation`
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