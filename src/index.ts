#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  CancelledNotificationSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { config } from 'dotenv';
import { loadConfig, validateConfig } from './config.js';
import { LogShipper } from './services/log-shipper.js';
import { Logger } from './services/logger.js';
import { RequestTracker } from './services/request-tracker.js';
import { ProgressReporter } from './services/progress-reporter.js';

// Load environment variables
config();

// Import tools from each template
import { GoogleGmailTools } from './tools/google-gmail-tools.js';
import { GoogleGmailClient } from './clients/google-gmail-client.js';
import { GoogleDriveTools } from './tools/google-drive-tools.js';
import { GoogleDriveClient } from './clients/google-drive-client.js';
import { GoogleCalendarTools } from './tools/google-calendar-tools.js';
import { GoogleCalendarClient } from './clients/google-calendar-client.js';
import { GoogleContactsTools } from './tools/google-contacts-tools.js';
import { GoogleContactsClient } from './clients/google-contacts-client.js';

// Import OAuth clients only if OAuth is enabled globally

// Import unified OAuth clients for special cases
import { GoogleOAuthClient } from './oauth/google-oauth-client.js';

class GsuiteServer {
  private server: Server;
  private logShipper!: LogShipper;
  private logger!: Logger;
  private requestTracker!: RequestTracker;
  private progressReporter!: ProgressReporter;
  
  // Initialize template tools
  private googleGmailTools: GoogleGmailTools;
  private googleGmailClient: GoogleGmailClient;
  private googleDriveTools: GoogleDriveTools;
  private googleDriveClient: GoogleDriveClient;
  private googleCalendarTools: GoogleCalendarTools;
  private googleCalendarClient: GoogleCalendarClient;
  private googleContactsTools: GoogleContactsTools;
  private googleContactsClient: GoogleContactsClient;
  
  // OAuth clients
  private googleOAuthClient: GoogleOAuthClient;

  constructor() {
    // Initialize logging first
    this.initializeLogging();
    
    this.server = new Server(
      {
        name: 'gsuite',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    // Initialize OAuth clients first
    this.googleOAuthClient = new GoogleOAuthClient();

    // Initialize template clients and tools
    // Google service - use unified GoogleOAuthClient
    this.googleGmailClient = new GoogleGmailClient({
      authToken: process.env.GOOGLE_OAUTH_CREDENTIALS,
      gOOGLEOAUTHCREDENTIALS: process.env.GOOGLE_OAUTH_CREDENTIALS,
      scopes: ["https://www.googleapis.com/auth/gmail.readonly","https://www.googleapis.com/auth/gmail.send","https://www.googleapis.com/auth/gmail.modify"],
      logger: this.logger,
      oauthClient: this.googleOAuthClient
    });
    this.googleGmailTools = new GoogleGmailTools(this.googleGmailClient);
    // Google service - use unified GoogleOAuthClient
    this.googleDriveClient = new GoogleDriveClient({
      authToken: process.env.GOOGLE_OAUTH_CREDENTIALS,
      gOOGLEOAUTHCREDENTIALS: process.env.GOOGLE_OAUTH_CREDENTIALS,
      scopes: ["https://www.googleapis.com/auth/drive","https://www.googleapis.com/auth/drive.file"],
      logger: this.logger,
      oauthClient: this.googleOAuthClient
    });
    this.googleDriveTools = new GoogleDriveTools(this.googleDriveClient);
    // Google service - use unified GoogleOAuthClient
    this.googleCalendarClient = new GoogleCalendarClient({
      authToken: process.env.GOOGLE_OAUTH_CREDENTIALS,
      gOOGLEOAUTHCREDENTIALS: process.env.GOOGLE_OAUTH_CREDENTIALS,
      scopes: ["https://www.googleapis.com/auth/calendar","https://www.googleapis.com/auth/calendar.events"],
      logger: this.logger,
      oauthClient: this.googleOAuthClient
    });
    this.googleCalendarTools = new GoogleCalendarTools(this.googleCalendarClient);
    // Google service - use unified GoogleOAuthClient
    this.googleContactsClient = new GoogleContactsClient({
      authToken: process.env.GOOGLE_OAUTH_CREDENTIALS,
      gOOGLEOAUTHCREDENTIALS: process.env.GOOGLE_OAUTH_CREDENTIALS,
      scopes: ["https://www.googleapis.com/auth/contacts","https://www.googleapis.com/auth/contacts.readonly"],
      logger: this.logger,
      oauthClient: this.googleOAuthClient
    });
    this.googleContactsTools = new GoogleContactsTools(this.googleContactsClient);

    this.setupHandlers();
    this.setupNotificationHandlers();
  }

  private initializeLogging() {
    const config = loadConfig();
    const validation = validateConfig(config);
    
    if (!validation.isValid) {
      console.error('Configuration validation failed:', validation.errors);
      process.exit(1);
    }
    
    this.logShipper = new LogShipper(config.logShipping);
    this.logger = new Logger({
      logLevel: config.logShipping.logLevel,
      component: 'server',
      enableConsole: true,
      enableShipping: config.logShipping.enabled,
      serverName: 'gsuite',
      logShipper: this.logShipper
    });
    
    this.logger.info('SERVER_INIT', 'MCP server initializing', {
      serverName: 'gsuite',
      logShippingEnabled: config.logShipping.enabled,
      logLevel: config.logShipping.logLevel
    });
    
    // Initialize request tracking and progress reporting
    this.requestTracker = new RequestTracker(this.logger);
    this.progressReporter = new ProgressReporter(
      this.server,
      this.logger,
      this.requestTracker
    );
    
    // Set up periodic cleanup
    setInterval(() => {
      this.requestTracker.cleanupStaleRequests();
      this.progressReporter.cleanupCompletedRequests();
    }, 60000);
  }

  private setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const tools = [];
      
      // Add google-gmail tools
      tools.push(...this.googleGmailTools.getToolDefinitions());
      // Add google-drive tools
      tools.push(...this.googleDriveTools.getToolDefinitions());
      // Add google-calendar tools
      tools.push(...this.googleCalendarTools.getToolDefinitions());
      // Add google-contacts tools
      tools.push(...this.googleContactsTools.getToolDefinitions());

      return { tools };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      const requestId = (request as any).id;
      const progressToken = request.params._meta?.progressToken;
      
      // Register request for tracking
      const context = this.requestTracker.registerRequest(
        requestId,
        progressToken,
        name
      );

      try {
        // Handle google-gmail tools
        if (this.googleGmailTools.canHandle(name)) {
          return await this.googleGmailTools.executeTool(name, args, context, this.progressReporter);
        }
        // Handle google-drive tools
        if (this.googleDriveTools.canHandle(name)) {
          return await this.googleDriveTools.executeTool(name, args, context, this.progressReporter);
        }
        // Handle google-calendar tools
        if (this.googleCalendarTools.canHandle(name)) {
          return await this.googleCalendarTools.executeTool(name, args, context, this.progressReporter);
        }
        // Handle google-contacts tools
        if (this.googleContactsTools.canHandle(name)) {
          return await this.googleContactsTools.executeTool(name, args, context, this.progressReporter);
        }

        throw new McpError(
          ErrorCode.MethodNotFound,
          `Unknown tool: ${name}`
        );
      } catch (error) {
        // Check if error is due to cancellation
        if (context.abortController.signal.aborted) {
          this.logger.info('REQUEST_ABORTED', 'Request was cancelled', {
            requestId,
            toolName: name,
            reason: context.abortController.signal.reason
          });
          throw new McpError(
            ErrorCode.InternalError,
            'Request was cancelled'
          );
        }
        
        if (error instanceof McpError) {
          throw error;
        }
        
        throw new McpError(
          ErrorCode.InternalError,
          `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`
        );
      } finally {
        // Clean up request tracking
        this.requestTracker.cleanup(requestId);
      }
    });
  }

  private setupNotificationHandlers() {
    // Handle cancellation notifications
    this.server.setNotificationHandler(CancelledNotificationSchema, async (notification) => {
      const { requestId, reason } = notification.params;
      
      this.logger.info('CANCELLATION_RECEIVED', 'Received cancellation notification', {
        requestId,
        reason
      });
      
      // Cancel the request
      const cancelled = this.requestTracker.cancelRequest(requestId, reason);
      
      if (!cancelled) {
        this.logger.debug('CANCELLATION_IGNORED', 'Cancellation ignored - request not found or already completed', {
          requestId
        });
      }
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    
    this.logger.info('SERVER_START', 'MCP server started successfully', {
      serverName: 'gsuite',
      transport: 'stdio'
    });
    
    console.error('gsuite MCP server running on stdio');
    
    // Handle graceful shutdown for log shipping
    const shutdown = async () => {
      this.logger.info('SERVER_SHUTDOWN', 'MCP server shutting down', {
        serverName: 'gsuite'
      });
      
      // Shutdown request tracking and progress reporting
      if (this.requestTracker) {
        this.requestTracker.shutdown();
      }
      if (this.progressReporter) {
        this.progressReporter.shutdown();
      }
      
      // Shutdown logging
      if (this.logShipper) {
        await this.logShipper.shutdown();
      }
      
      process.exit(0);
    };
    
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }
}

const server = new GsuiteServer();
server.run().catch(console.error);