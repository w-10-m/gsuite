import { GoogleCalendarClient } from '../clients/google-calendar-client.js';
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { Logger } from '../services/logger.js';
import { RequestContext } from '../services/request-tracker.js';
import { ProgressReporter } from '../services/progress-reporter.js';

export interface GoogleCalendarToolsConfig {
  gOOGLEOAUTHCREDENTIALS?: string;
  scopes?: any;
  authToken?: string;
  logger?: Logger;
}

export class GoogleCalendarTools {
  private client: GoogleCalendarClient;
  private initialized = false;
  private logger: Logger;

  constructor(client: GoogleCalendarClient) {
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
        integration: 'google-calendar',
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
        name: 'google-calendar_list_events',
        description: 'Returns events on the specified calendar',
        inputSchema: {
          type: 'object',
          properties: {
            calendarId: {
              type: 'string',
              description: 'Calendar identifier. Use &#x27;primary&#x27; for the primary calendar'
            },
            maxResults: {
              type: 'number',
              description: 'Maximum number of events returned (default 250, max 2500)'
            },
            orderBy: {
              type: 'string',
              description: 'Order by the start time or last modification time (startTime, updated)'
            },
            pageToken: {
              type: 'string',
              description: 'Token specifying which result page to return'
            },
            q: {
              type: 'string',
              description: 'Free text search terms to find events'
            },
            showDeleted: {
              type: 'boolean',
              description: 'Whether to include deleted events'
            },
            singleEvents: {
              type: 'boolean',
              description: 'Whether to expand recurring events into instances'
            },
            timeMax: {
              type: 'string',
              description: 'Upper bound for event&#x27;s start time (RFC3339 timestamp)'
            },
            timeMin: {
              type: 'string',
              description: 'Lower bound for event&#x27;s end time (RFC3339 timestamp)'
            },
            timeZone: {
              type: 'string',
              description: 'Time zone used in the response'
            }
          },
          required: ['calendarId']
        }
      },
      {
        name: 'google-calendar_get_event',
        description: 'Returns an event',
        inputSchema: {
          type: 'object',
          properties: {
            calendarId: {
              type: 'string',
              description: 'Calendar identifier. Use &#x27;primary&#x27; for the primary calendar'
            },
            eventId: {
              type: 'string',
              description: 'Event identifier'
            },
            timeZone: {
              type: 'string',
              description: 'Time zone used in the response'
            }
          },
          required: ['calendarId','eventId']
        }
      },
      {
        name: 'google-calendar_create_event',
        description: 'Creates an event',
        inputSchema: {
          type: 'object',
          properties: {
            calendarId: {
              type: 'string',
              description: 'Calendar identifier. Use &#x27;primary&#x27; for the primary calendar'
            },
            summary: {
              type: 'string',
              description: 'Title of the event'
            },
            description: {
              type: 'string',
              description: 'Description of the event'
            },
            location: {
              type: 'string',
              description: 'Geographic location of the event'
            },
            start: {
              type: 'object',
              description: 'Start time of the event. Use &#x27;date&#x27; for all-day events or &#x27;dateTime&#x27; with timeZone'
            },
            end: {
              type: 'object',
              description: 'End time of the event. Use &#x27;date&#x27; for all-day events or &#x27;dateTime&#x27; with timeZone'
            },
            attendees: {
              type: 'array',
              description: 'List of attendees with email addresses'
            },
            reminders: {
              type: 'object',
              description: 'Information about the event&#x27;s reminders'
            },
            recurrence: {
              type: 'array',
              description: 'List of RRULE, EXRULE, RDATE and EXDATE lines for recurring event'
            },
            sendNotifications: {
              type: 'boolean',
              description: 'Whether to send notifications about the creation of the new event'
            },
            sendUpdates: {
              type: 'string',
              description: 'Whether to send notifications to attendees (all, externalOnly, none)'
            }
          },
          required: ['calendarId','summary','start','end']
        }
      },
      {
        name: 'google-calendar_update_event',
        description: 'Updates an event',
        inputSchema: {
          type: 'object',
          properties: {
            calendarId: {
              type: 'string',
              description: 'Calendar identifier. Use &#x27;primary&#x27; for the primary calendar'
            },
            eventId: {
              type: 'string',
              description: 'Event identifier'
            },
            summary: {
              type: 'string',
              description: 'Title of the event'
            },
            description: {
              type: 'string',
              description: 'Description of the event'
            },
            location: {
              type: 'string',
              description: 'Geographic location of the event'
            },
            start: {
              type: 'object',
              description: 'Start time of the event (required - must include current or new start time)'
            },
            end: {
              type: 'object',
              description: 'End time of the event (required - must include current or new end time)'
            },
            attendees: {
              type: 'array',
              description: 'List of attendees'
            },
            sendNotifications: {
              type: 'boolean',
              description: 'Whether to send notifications about the update'
            },
            sendUpdates: {
              type: 'string',
              description: 'Whether to send notifications to attendees (all, externalOnly, none)'
            }
          },
          required: ['calendarId','eventId','start','end']
        }
      },
      {
        name: 'google-calendar_delete_event',
        description: 'Deletes an event. Returns 204 No Content with empty body on success.',
        inputSchema: {
          type: 'object',
          properties: {
            calendarId: {
              type: 'string',
              description: 'Calendar identifier. Use &#x27;primary&#x27; for the primary calendar'
            },
            eventId: {
              type: 'string',
              description: 'Event identifier'
            },
            sendNotifications: {
              type: 'boolean',
              description: 'Whether to send notifications about the deletion'
            },
            sendUpdates: {
              type: 'string',
              description: 'Whether to send notifications to attendees (all, externalOnly, none)'
            }
          },
          required: ['calendarId','eventId']
        }
      },
      {
        name: 'google-calendar_list_calendars',
        description: 'Returns the calendars on the user&#x27;s calendar list',
        inputSchema: {
          type: 'object',
          properties: {
            maxResults: {
              type: 'number',
              description: 'Maximum number of entries returned (default 100, max 250)'
            },
            minAccessRole: {
              type: 'string',
              description: 'The minimum access role for the user in the returned entries (freeBusyReader, reader, writer, owner)'
            },
            pageToken: {
              type: 'string',
              description: 'Token specifying which result page to return'
            },
            showDeleted: {
              type: 'boolean',
              description: 'Whether to include deleted calendar list entries in the result'
            },
            showHidden: {
              type: 'boolean',
              description: 'Whether to show hidden entries'
            }
          },
          required: []
        }
      }
    ];
  }

  canHandle(toolName: string): boolean {
    const supportedTools: string[] = [
      'google-calendar_list_events',
      'google-calendar_get_event',
      'google-calendar_create_event',
      'google-calendar_update_event',
      'google-calendar_delete_event',
      'google-calendar_list_calendars'
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
        supportedTools: ['google-calendar_list_events', 'google-calendar_get_event', 'google-calendar_create_event', 'google-calendar_update_event', 'google-calendar_delete_event', 'google-calendar_list_calendars']
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
        case 'google-calendar_list_events':
          this.logger.debug('TOOL_EXECUTE', 'Calling client method', {
            tool: 'google-calendar_list_events',
            clientMethod: 'listEvents',
            hasAbortSignal: !!requestOptions.signal,
            hasProgressCallback: !!requestOptions.onProgress
          });
          
          // Report initial progress
          if (context?.progressToken && progressReporter) {
            await progressReporter.report(context.progressToken, {
              progress: 0,
              total: 100,
              message: `Starting list_events operation...`
            });
          }
          
          result = await this.client.listEvents(args, requestOptions);
          
          // Report completion
          if (context?.progressToken && progressReporter) {
            await progressReporter.report(context.progressToken, {
              progress: 100,
              total: 100,
              message: `Completed list_events operation`
            });
          }
          break;
        case 'google-calendar_get_event':
          this.logger.debug('TOOL_EXECUTE', 'Calling client method', {
            tool: 'google-calendar_get_event',
            clientMethod: 'getEvent',
            hasAbortSignal: !!requestOptions.signal,
            hasProgressCallback: !!requestOptions.onProgress
          });
          
          // Report initial progress
          if (context?.progressToken && progressReporter) {
            await progressReporter.report(context.progressToken, {
              progress: 0,
              total: 100,
              message: `Starting get_event operation...`
            });
          }
          
          result = await this.client.getEvent(args, requestOptions);
          
          // Report completion
          if (context?.progressToken && progressReporter) {
            await progressReporter.report(context.progressToken, {
              progress: 100,
              total: 100,
              message: `Completed get_event operation`
            });
          }
          break;
        case 'google-calendar_create_event':
          this.logger.debug('TOOL_EXECUTE', 'Calling client method', {
            tool: 'google-calendar_create_event',
            clientMethod: 'createEvent',
            hasAbortSignal: !!requestOptions.signal,
            hasProgressCallback: !!requestOptions.onProgress
          });
          
          // Report initial progress
          if (context?.progressToken && progressReporter) {
            await progressReporter.report(context.progressToken, {
              progress: 0,
              total: 100,
              message: `Starting create_event operation...`
            });
          }
          
          result = await this.client.createEvent(args, requestOptions);
          
          // Report completion
          if (context?.progressToken && progressReporter) {
            await progressReporter.report(context.progressToken, {
              progress: 100,
              total: 100,
              message: `Completed create_event operation`
            });
          }
          break;
        case 'google-calendar_update_event':
          this.logger.debug('TOOL_EXECUTE', 'Calling client method', {
            tool: 'google-calendar_update_event',
            clientMethod: 'updateEvent',
            hasAbortSignal: !!requestOptions.signal,
            hasProgressCallback: !!requestOptions.onProgress
          });
          
          // Report initial progress
          if (context?.progressToken && progressReporter) {
            await progressReporter.report(context.progressToken, {
              progress: 0,
              total: 100,
              message: `Starting update_event operation...`
            });
          }
          
          result = await this.client.updateEvent(args, requestOptions);
          
          // Report completion
          if (context?.progressToken && progressReporter) {
            await progressReporter.report(context.progressToken, {
              progress: 100,
              total: 100,
              message: `Completed update_event operation`
            });
          }
          break;
        case 'google-calendar_delete_event':
          this.logger.debug('TOOL_EXECUTE', 'Calling client method', {
            tool: 'google-calendar_delete_event',
            clientMethod: 'deleteEvent',
            hasAbortSignal: !!requestOptions.signal,
            hasProgressCallback: !!requestOptions.onProgress
          });
          
          // Report initial progress
          if (context?.progressToken && progressReporter) {
            await progressReporter.report(context.progressToken, {
              progress: 0,
              total: 100,
              message: `Starting delete_event operation...`
            });
          }
          
          result = await this.client.deleteEvent(args, requestOptions);
          
          // Report completion
          if (context?.progressToken && progressReporter) {
            await progressReporter.report(context.progressToken, {
              progress: 100,
              total: 100,
              message: `Completed delete_event operation`
            });
          }
          break;
        case 'google-calendar_list_calendars':
          this.logger.debug('TOOL_EXECUTE', 'Calling client method', {
            tool: 'google-calendar_list_calendars',
            clientMethod: 'listCalendars',
            hasAbortSignal: !!requestOptions.signal,
            hasProgressCallback: !!requestOptions.onProgress
          });
          
          // Report initial progress
          if (context?.progressToken && progressReporter) {
            await progressReporter.report(context.progressToken, {
              progress: 0,
              total: 100,
              message: `Starting list_calendars operation...`
            });
          }
          
          result = await this.client.listCalendars(args, requestOptions);
          
          // Report completion
          if (context?.progressToken && progressReporter) {
            await progressReporter.report(context.progressToken, {
              progress: 100,
              total: 100,
              message: `Completed list_calendars operation`
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