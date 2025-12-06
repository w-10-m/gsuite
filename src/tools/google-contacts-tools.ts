import { GoogleContactsClient } from '../clients/google-contacts-client.js';
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { Logger } from '../services/logger.js';
import { RequestContext } from '../services/request-tracker.js';
import { ProgressReporter } from '../services/progress-reporter.js';

export interface GoogleContactsToolsConfig {
  gOOGLEOAUTHCREDENTIALS?: string;
  scopes?: any;
  authToken?: string;
  logger?: Logger;
}

export class GoogleContactsTools {
  private client: GoogleContactsClient;
  private initialized = false;
  private logger: Logger;

  constructor(client: GoogleContactsClient) {
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
        integration: 'google-contacts',
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
        name: 'google-contacts_create_contact',
        description: 'Create a new contact with specified fields',
        inputSchema: {
          type: 'object',
          properties: {
            personFields: {
              type: 'string',
              description: 'Comma-separated list of fields to return (e.g., &#x27;names,emailAddresses,phoneNumbers,addresses,organizations&#x27;)'
            },
            sources: {
              type: 'string',
              description: 'Sources to create the contact in (default: &#x27;CONTACT&#x27;)'
            },
            names: {
              type: 'object',
              description: 'Array of name objects with givenName, familyName, displayName, etc.'
            },
            emailAddresses: {
              type: 'object',
              description: 'Array of email address objects with value, type, etc.'
            },
            phoneNumbers: {
              type: 'object',
              description: 'Array of phone number objects with value, type, etc.'
            },
            addresses: {
              type: 'object',
              description: 'Array of address objects with formattedValue, type, etc.'
            },
            organizations: {
              type: 'object',
              description: 'Array of organization objects with name, title, etc.'
            },
            biographies: {
              type: 'object',
              description: 'Array of biography objects with value, contentType, etc.'
            },
            birthdays: {
              type: 'object',
              description: 'Array of birthday objects with date information'
            },
            urls: {
              type: 'object',
              description: 'Array of URL objects with value, type, etc.'
            }
          },
          required: ['personFields']
        }
      },
      {
        name: 'google-contacts_update_contact',
        description: 'Update an existing contact. IMPORTANT: Include the &#x27;etag&#x27; field in the request body to prevent conflicts. Get the current etag by first calling get_contact or from a previous create/update response.',
        inputSchema: {
          type: 'object',
          properties: {
            "person.resourceName": {
              type: 'string',
              description: 'Resource name of the contact (e.g., &#x27;people/c1234567890&#x27;)'
            },
            updatePersonFields: {
              type: 'string',
              description: 'Comma-separated list of fields to update (e.g., &#x27;names,emailAddresses,phoneNumbers&#x27;)'
            },
            personFields: {
              type: 'string',
              description: 'Comma-separated list of fields to return in response'
            },
            sources: {
              type: 'string',
              description: 'Sources to update the contact in'
            },
            names: {
              type: 'object',
              description: 'Array of name objects to update'
            },
            emailAddresses: {
              type: 'object',
              description: 'Array of email address objects to update'
            },
            phoneNumbers: {
              type: 'object',
              description: 'Array of phone number objects to update'
            },
            addresses: {
              type: 'object',
              description: 'Array of address objects to update'
            },
            organizations: {
              type: 'object',
              description: 'Array of organization objects to update'
            },
            biographies: {
              type: 'object',
              description: 'Array of biography objects to update'
            },
            birthdays: {
              type: 'object',
              description: 'Array of birthday objects to update'
            },
            urls: {
              type: 'object',
              description: 'Array of URL objects to update'
            },
            etag: {
              type: 'string',
              description: 'ETag from the contact&#x27;s current state (obtained from get_contact, create_contact, or previous update_contact response). Required for concurrency control and conflict prevention.'
            }
          },
          required: ['person.resourceName','updatePersonFields','etag']
        }
      },
      {
        name: 'google-contacts_delete_contact',
        description: 'Delete a contact permanently',
        inputSchema: {
          type: 'object',
          properties: {
            resourceName: {
              type: 'string',
              description: 'Resource name of the contact to delete (e.g., &#x27;people/c1234567890&#x27;)'
            }
          },
          required: ['resourceName']
        }
      },
      {
        name: 'google-contacts_search_contacts',
        description: 'Search across all contacts with text query',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Text search query to match against contact fields'
            },
            pageSize: {
              type: 'number',
              description: 'Number of results to return (max 30, default 10)'
            },
            readMask: {
              type: 'string',
              description: 'Comma-separated list of fields to return (e.g., &#x27;names,emailAddresses,phoneNumbers&#x27;)'
            },
            sources: {
              type: 'string',
              description: 'Comma-separated list of sources to search (READ_SOURCE_TYPE_CONTACT, READ_SOURCE_TYPE_DOMAIN_CONTACT)'
            }
          },
          required: ['query']
        }
      },
      {
        name: 'google-contacts_list_contacts',
        description: 'list_contacts endpoint for google-contacts',
        inputSchema: {
          type: 'object',
          properties: {
          },
          required: []
        }
      },
      {
        name: 'google-contacts_get_contact',
        description: 'get_contact endpoint for google-contacts',
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
      'google-contacts_create_contact',
      'google-contacts_update_contact',
      'google-contacts_delete_contact',
      'google-contacts_search_contacts',
      'google-contacts_list_contacts',
      'google-contacts_get_contact'
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
        supportedTools: ['google-contacts_create_contact', 'google-contacts_update_contact', 'google-contacts_delete_contact', 'google-contacts_search_contacts', 'google-contacts_list_contacts', 'google-contacts_get_contact']
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
        case 'google-contacts_create_contact':
          this.logger.debug('TOOL_EXECUTE', 'Calling client method', {
            tool: 'google-contacts_create_contact',
            clientMethod: 'createContact',
            hasAbortSignal: !!requestOptions.signal,
            hasProgressCallback: !!requestOptions.onProgress
          });
          
          // Report initial progress
          if (context?.progressToken && progressReporter) {
            await progressReporter.report(context.progressToken, {
              progress: 0,
              total: 100,
              message: `Starting create_contact operation...`
            });
          }
          
          result = await this.client.createContact(args, requestOptions);
          
          // Report completion
          if (context?.progressToken && progressReporter) {
            await progressReporter.report(context.progressToken, {
              progress: 100,
              total: 100,
              message: `Completed create_contact operation`
            });
          }
          break;
        case 'google-contacts_update_contact':
          this.logger.debug('TOOL_EXECUTE', 'Calling client method', {
            tool: 'google-contacts_update_contact',
            clientMethod: 'updateContact',
            hasAbortSignal: !!requestOptions.signal,
            hasProgressCallback: !!requestOptions.onProgress
          });
          
          // Report initial progress
          if (context?.progressToken && progressReporter) {
            await progressReporter.report(context.progressToken, {
              progress: 0,
              total: 100,
              message: `Starting update_contact operation...`
            });
          }
          
          result = await this.client.updateContact(args, requestOptions);
          
          // Report completion
          if (context?.progressToken && progressReporter) {
            await progressReporter.report(context.progressToken, {
              progress: 100,
              total: 100,
              message: `Completed update_contact operation`
            });
          }
          break;
        case 'google-contacts_delete_contact':
          this.logger.debug('TOOL_EXECUTE', 'Calling client method', {
            tool: 'google-contacts_delete_contact',
            clientMethod: 'deleteContact',
            hasAbortSignal: !!requestOptions.signal,
            hasProgressCallback: !!requestOptions.onProgress
          });
          
          // Report initial progress
          if (context?.progressToken && progressReporter) {
            await progressReporter.report(context.progressToken, {
              progress: 0,
              total: 100,
              message: `Starting delete_contact operation...`
            });
          }
          
          result = await this.client.deleteContact(args, requestOptions);
          
          // Report completion
          if (context?.progressToken && progressReporter) {
            await progressReporter.report(context.progressToken, {
              progress: 100,
              total: 100,
              message: `Completed delete_contact operation`
            });
          }
          break;
        case 'google-contacts_search_contacts':
          this.logger.debug('TOOL_EXECUTE', 'Calling client method', {
            tool: 'google-contacts_search_contacts',
            clientMethod: 'searchContacts',
            hasAbortSignal: !!requestOptions.signal,
            hasProgressCallback: !!requestOptions.onProgress
          });
          
          // Report initial progress
          if (context?.progressToken && progressReporter) {
            await progressReporter.report(context.progressToken, {
              progress: 0,
              total: 100,
              message: `Starting search_contacts operation...`
            });
          }
          
          result = await this.client.searchContacts(args, requestOptions);
          
          // Report completion
          if (context?.progressToken && progressReporter) {
            await progressReporter.report(context.progressToken, {
              progress: 100,
              total: 100,
              message: `Completed search_contacts operation`
            });
          }
          break;
        case 'google-contacts_list_contacts':
          this.logger.debug('TOOL_EXECUTE', 'Calling client method', {
            tool: 'google-contacts_list_contacts',
            clientMethod: 'listContacts',
            hasAbortSignal: !!requestOptions.signal,
            hasProgressCallback: !!requestOptions.onProgress
          });
          
          // Report initial progress
          if (context?.progressToken && progressReporter) {
            await progressReporter.report(context.progressToken, {
              progress: 0,
              total: 100,
              message: `Starting list_contacts operation...`
            });
          }
          
          result = await this.client.listContacts(args, requestOptions);
          
          // Report completion
          if (context?.progressToken && progressReporter) {
            await progressReporter.report(context.progressToken, {
              progress: 100,
              total: 100,
              message: `Completed list_contacts operation`
            });
          }
          break;
        case 'google-contacts_get_contact':
          this.logger.debug('TOOL_EXECUTE', 'Calling client method', {
            tool: 'google-contacts_get_contact',
            clientMethod: 'getContact',
            hasAbortSignal: !!requestOptions.signal,
            hasProgressCallback: !!requestOptions.onProgress
          });
          
          // Report initial progress
          if (context?.progressToken && progressReporter) {
            await progressReporter.report(context.progressToken, {
              progress: 0,
              total: 100,
              message: `Starting get_contact operation...`
            });
          }
          
          result = await this.client.getContact(args, requestOptions);
          
          // Report completion
          if (context?.progressToken && progressReporter) {
            await progressReporter.report(context.progressToken, {
              progress: 100,
              total: 100,
              message: `Completed get_contact operation`
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