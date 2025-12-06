import axios, { AxiosInstance } from 'axios';
import { Logger } from '../services/logger.js';
import { RequestOptions, ProgressCallback } from '../types.js';

export interface GoogleGmailClientConfig {
  gOOGLEOAUTHCREDENTIALS?: string;
  scopes?: any;
  timeout?: number;
  rateLimit?: number; // requests per minute
  authToken?: string;
  logger?: Logger;
  oauthClient?: any; // OAuth client for token management
}

export class GoogleGmailClient {
  private httpClient: AxiosInstance;
  private config: GoogleGmailClientConfig;
  private sessionId: string;
  private logger: Logger;
  private oauthClient: any; // OAuth client for token management
  
  constructor(config: GoogleGmailClientConfig) {
    this.config = config;
    
    // Generate unique session ID for this client instance
    this.sessionId = `google-gmail-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    
    // Initialize logger (fallback to console if not provided)
    this.logger = config.logger || new Logger(
      {
        logLevel: 'ERROR',
        component: 'client',
        enableConsole: true,
        enableShipping: false,
        serverName: 'gsuite'
      }
    );
    
    this.logger.info('CLIENT_INIT', 'Client instance created', { 
      baseUrl: this.resolveBaseUrl(),
      timeout: this.config.timeout || 30000,
      hasRateLimit: !!this.config.rateLimit,
      configKeys: Object.keys(config)
    });

    // Initialize OAuth client from config if provided
    this.oauthClient = config.oauthClient;
        
    this.httpClient = axios.create({
      baseURL: this.resolveBaseUrl(),
      timeout: this.config.timeout || 30000,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'gsuite/1.0.0',
        ...this.getAuthHeaders()
      },
    });

    // Add request interceptor for rate limiting
    if (this.config.rateLimit) {
      this.setupRateLimit(this.config.rateLimit);
    }

    // Add request interceptor for logging
    this.httpClient.interceptors.request.use(
      (config) => {
        this.logger.logRequestStart(
          config.method?.toUpperCase() || 'GET',
          `${config.baseURL}${config.url}`,
          {
            hasData: !!config.data,
            hasParams: !!(config.params && Object.keys(config.params).length > 0),
            headers: Object.keys(config.headers || {})
          }
        );
        
        if (config.data) {
          this.logger.debug('HTTP_REQUEST_BODY', 'Request body data', {
            dataType: typeof config.data,
            dataSize: JSON.stringify(config.data).length
          });
        }
        
        if (config.params && Object.keys(config.params).length > 0) {
          this.logger.debug('HTTP_REQUEST_PARAMS', 'Query parameters', {
            paramCount: Object.keys(config.params).length,
            paramKeys: Object.keys(config.params)
          });
        }
        
        return config;
      },
      (error) => {
        this.logger.error('HTTP_REQUEST_ERROR', 'Request interceptor error', {
          error: error.message,
          code: error.code
        });
        return Promise.reject(error);
      }
    );

    // Add response interceptor for logging and error handling
    this.httpClient.interceptors.response.use(
      (response) => {
        this.logger.logRequestSuccess(
          response.config?.method?.toUpperCase() || 'GET',
          `${response.config?.baseURL}${response.config?.url}`,
          response.status,
          0, // Duration will be calculated in endpoint methods
          {
            statusText: response.statusText,
            responseSize: JSON.stringify(response.data).length,
            headers: Object.keys(response.headers || {})
          }
        );
        return response;
      },
      (error) => {
        this.logger.logRequestError(
          error.config?.method?.toUpperCase() || 'GET',
          `${error.config?.baseURL}${error.config?.url}`,
          error,
          0, // Duration will be calculated in endpoint methods
          {
            hasResponseData: !!error.response?.data
          }
        );
        throw error;
      }
    );
  }

  private setupRateLimit(requestsPerMinute: number) {
    const interval = 60000 / requestsPerMinute; // ms between requests
    let lastRequestTime = 0;

    this.logger.info('RATE_LIMIT_SETUP', 'Rate limiting configured', {
      requestsPerMinute,
      intervalMs: interval
    });

    this.httpClient.interceptors.request.use(async (config) => {
      const now = Date.now();
      const timeSinceLastRequest = now - lastRequestTime;
      
      if (timeSinceLastRequest < interval) {
        const delayMs = interval - timeSinceLastRequest;
        this.logger.logRateLimit('HTTP_REQUEST', delayMs, {
          timeSinceLastRequest,
          requiredInterval: interval
        });
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
      
      lastRequestTime = Date.now();
      return config;
    });
  }

  private resolveBaseUrl(): string {
    // Debug logging for base_url resolution
    // console.error('[GoogleGmailClient] Resolving base URL...');
    // console.error('[GoogleGmailClient] Template base_url:', 'https://gmail.googleapis.com/gmail/v1');
    // console.error('[GoogleGmailClient] CustomConfig baseUrl:', '');
    
    let baseUrl = 'https://gmail.googleapis.com/gmail/v1';
    
    // console.error('[GoogleGmailClient] Initial resolved baseUrl:', baseUrl);
    
    // If no base URL was found, throw an error
    if (!baseUrl) {
      throw new Error(`No base URL configured for google-gmail. Please provide base_url in template or customConfig.baseUrl.`);
    }
    
    // Handle dynamic domain replacement for patterns like CONFLUENCE_DOMAIN, JIRA_DOMAIN, etc.
    const domainEnvVar = `GOOGLE-GMAIL_DOMAIN`;
    const domain = process.env[domainEnvVar];
    // console.error(`[GoogleGmailClient] Domain env var (${domainEnvVar}):`, domain);
    
    // Check for SERVICE_DOMAIN pattern (e.g., CONFLUENCE_DOMAIN, JIRA_DOMAIN, SLACK_DOMAIN)
    // This handles both YOUR_DOMAIN and {SERVICE}_DOMAIN patterns in base URLs
    if (baseUrl.includes('YOUR_DOMAIN') || baseUrl.includes(`${domainEnvVar}`)) {
      if (!domain) {
        throw new Error(`Missing domain configuration. Please set ${domainEnvVar} environment variable.`);
      }
      
      // Replace the placeholder with the actual domain value
      // This handles patterns like https://CONFLUENCE_DOMAIN.atlassian.net
      if (baseUrl.includes('YOUR_DOMAIN')) {
        baseUrl = baseUrl.replace(/YOUR_DOMAIN/g, domain);
      } 
      if (baseUrl.includes(`${domainEnvVar}`)) {
        // Replace all occurrences of the service-specific domain placeholder
        const regex = new RegExp(domainEnvVar, 'g');
        baseUrl = baseUrl.replace(regex, domain);
      }
      
      this.logger.info('DOMAIN_RESOLVED', `Resolved base URL with domain`, {
        template: 'google-gmail',
        baseUrl: baseUrl
      });
    }
    
    // console.error('[GoogleGmailClient] Final resolved baseUrl:', baseUrl);
    return baseUrl;
  }

  private getAuthHeaders(): Record<string, string> {
    // OAuth authentication (both ConstructionWire and standard OAuth) - handled dynamically
    // Tokens will be applied asynchronously via makeAuthenticatedRequest
    this.logger.logAuthEvent('oauth_auth_setup', true, {
      authType: 'oauth2',
      message: 'OAuth tokens will be applied dynamically during requests',
      oauthClientPresent: !!this.oauthClient
    });
    return {};
  }

  /**
   * Initialize the client (for OAuth clients that need initialization)
   */
  async initialize(): Promise<void> {
    if (this.oauthClient) {
      await this.oauthClient.initialize();
      this.logger.info('CLIENT_INITIALIZE', 'OAuth client initialized');
    }
  }

  /**
   * Get the session ID for this client instance
   */
  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * Make an authenticated request with proper headers and cancellation support
   */
  private async makeAuthenticatedRequest(config: any, options?: RequestOptions): Promise<any> {
    // Add abort signal if provided
    if (options?.signal) {
      config.signal = options.signal;
    }
    // Get OAuth token for standard OAuth
    this.logger.info('REQUEST_AUTH', 'Applying standard OAuth authentication', {
      authType: 'oauth2',
      requestUrl: config.url,
      hasOAuthClient: !!this.oauthClient
    });
    
    if (this.oauthClient) {
      const accessToken = await this.oauthClient.getValidAccessToken();
      config.headers = {
        ...config.headers,
        'Authorization': `Bearer ${accessToken}`
      };
      
      this.logger.logAuthEvent('oauth_token_applied', true, {
        authType: 'oauth2',
        tokenPreview: accessToken ? accessToken.substring(0, 8) + '...' : 'null',
        header: 'Authorization',
        tokenSource: 'standard_oauth',
        finalHeaders: Object.keys(config.headers)
      });
    } else {
      this.logger.warn('OAUTH_CLIENT_MISSING', 'OAuth client not available for OAuth-enabled template', {
        authType: 'oauth2',
        requestUrl: config.url
      });
    }
    
    return this.httpClient.request(config);
  }

  private buildPath(template: string, params: Record<string, any>): string {
    let path = template;
    
    // Custom encoding that preserves forward slashes for API paths
    const encodePathComponent = (value: string): string => {
      // For Google API resource names like "people/c123", preserve the forward slash
      return encodeURIComponent(value).replace(/%2F/g, '/');
    };
    
    // Handle Google-style path templates: {resourceName=people/*} and {person.resourceName=people/*}
    const googlePathTemplateRegex = /{([^}=]+)=[^}]*}/g;
    let match;
    const processedParams: string[] = [];
    
    while ((match = googlePathTemplateRegex.exec(template)) !== null) {
      const fullMatch = match[0]; // e.g., "{resourceName=people/*}"
      const paramName = match[1]; // e.g., "resourceName" or "person.resourceName"
      
      if (paramName && params[paramName] !== undefined) {
        path = path.replace(fullMatch, encodePathComponent(String(params[paramName])));
        processedParams.push(paramName);
      }
    }
    
    // Handle standard path templates: {resourceName}
    for (const [key, value] of Object.entries(params)) {
      if (!processedParams.includes(key)) {
        const standardTemplate = `{${key}}`;
        if (path.includes(standardTemplate)) {
          path = path.replace(standardTemplate, encodePathComponent(String(value)));
          processedParams.push(key);
        }
      }
    }
    
    this.logger.debug('PATH_BUILD', 'Built API path from template', {
      template,
      resultPath: path,
      paramCount: Object.keys(params).length,
      paramKeys: Object.keys(params),
      processedParams,
      hasGoogleTemplates: googlePathTemplateRegex.test(template)
    });
    return path;
  }

  /* DEBUG: endpoint={"name":"list_messages","method":"GET","path":"/users/{userId}/messages","description":"List messages in user's mailbox with optional filtering","parameters":{"userId":{"type":"string","required":false,"description":"User's email address or 'me' for authenticated user","location":"path"},"q":{"type":"string","required":false,"description":"Gmail search query (e.g., 'from:user@example.com subject:important')","location":"query"},"labelIds":{"type":"string","required":false,"description":"Comma-separated list of label IDs to filter by","location":"query"},"maxResults":{"type":"number","required":false,"description":"Maximum number of messages to return (1-500, default 100)","location":"query"},"pageToken":{"type":"string","required":false,"description":"Page token for pagination","location":"query"},"includeSpamTrash":{"type":"boolean","required":false,"description":"Include messages from SPAM and TRASH","location":"query"}},"response_format":"json","category":"Email Management"} */
  async listMessages(params: any, options?: RequestOptions): Promise<any> {
    const startTime = Date.now();
    this.logger.info('ENDPOINT_START', 'Endpoint execution started', {
      endpoint: 'list_messages',
      method: 'GET',
      path: '/users/{userId}/messages',
      paramCount: Object.keys(params || {}).length,
      paramKeys: Object.keys(params || {})
    });
    
    try {
      
      // Extract and separate parameters by location: path, query, body
      const pathTemplate = '/users/{userId}/messages';
      const pathParams: Record<string, any> = {};
      const queryParams: Record<string, any> = {};
      const bodyParams: Record<string, any> = {};
      const extractedParams: string[] = [];
      
      // Handle Google-style path templates: {resourceName=people/*} and {person.resourceName=people/*}
      const googlePathTemplateRegex = /{([^}=]+)=[^}]*}/g;
      let match;
      
      while ((match = googlePathTemplateRegex.exec(pathTemplate)) !== null) {
        const paramName = match[1]; // e.g., "resourceName" or "person.resourceName"
        if (paramName && params[paramName] !== undefined) {
          pathParams[paramName] = params[paramName];
          extractedParams.push(paramName);
        }
      }
      
      // Handle standard path templates: {resourceName}
      const standardPathParams = pathTemplate.match(/{([^}=]+)}/g) || [];
      standardPathParams.forEach(paramTemplate => {
        const paramName = paramTemplate.slice(1, -1); // Remove { }
        // Only process if not already handled by Google template logic
        if (!extractedParams.includes(paramName)) {
          if (params[paramName] !== undefined) {
            pathParams[paramName] = params[paramName];
            extractedParams.push(paramName);
          } else {
            // Provide default values for optional path parameters
            if (paramName === 'userId') {
              pathParams[paramName] = 'me'; // Default to authenticated user
              extractedParams.push(paramName);
            }
          }
        }
      });
      
      // Check if any parameter has raw_array flag
      let hasRawArrayBody = false;
      let rawBodyData: any = undefined;
      
      // Separate remaining parameters by location (query vs body)
      if (params[""] !== undefined) {
        queryParams[""] = params[""];
        extractedParams.push("");
      }
      if (params[""] !== undefined) {
        queryParams[""] = params[""];
        extractedParams.push("");
      }
      if (params[""] !== undefined) {
        queryParams[""] = params[""];
        extractedParams.push("");
      }
      if (params[""] !== undefined) {
        queryParams[""] = params[""];
        extractedParams.push("");
      }
      if (params[""] !== undefined) {
        queryParams[""] = params[""];
        extractedParams.push("");
      }
      
      // Any remaining unprocessed parameters default to body for backward compatibility
      for (const [key, value] of Object.entries(params)) {
        if (!extractedParams.includes(key)) {
          bodyParams[key] = value;
        }
      }
      
      // Validate required parameters
      
      const path = this.buildPath('/users/{userId}/messages', pathParams);
      // For GraphQL endpoints that use '/' as the path, use empty string to avoid double slash
      const requestPath = path === '/' ? '' : path;
      
      // Report initial progress if callback provided
      if (options?.onProgress) {
        await options.onProgress({
          progress: 0,
          total: 100,
          message: `Starting list_messages request...`
        });
      }
      
      // Use authenticated request for OAuth (both ConstructionWire and standard OAuth)
      const response = await this.makeAuthenticatedRequest({ method: 'GET', url: path, params: queryParams }, options);
      
      // Report completion progress if callback provided
      if (options?.onProgress) {
        await options.onProgress({
          progress: 100,
          total: 100,
          message: `Completed list_messages request`
        });
      }
      
      const duration = Date.now() - startTime;
      this.logger.info('ENDPOINT_SUCCESS', 'Endpoint execution completed successfully', {
        endpoint: 'list_messages',
        method: 'GET',
        path: '/users/{userId}/messages',
        duration_ms: duration,
        responseDataSize: JSON.stringify(response.data).length
      });
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response.data, null, 2)
          }
        ]
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      
      // Check if error is due to cancellation
      if (axios.isCancel(error)) {
        this.logger.info('REQUEST_CANCELLED', 'Request was cancelled', {
          endpoint: 'list_messages',
          method: 'GET',
          path: '/users/{userId}/messages',
          duration_ms: duration
        });
        throw new Error('Request was cancelled');
      }
      
      this.logger.error('ENDPOINT_ERROR', 'Endpoint execution failed', {
        endpoint: 'list_messages',
        method: 'GET',
        path: '/users/{userId}/messages',
        duration_ms: duration,
        error: error instanceof Error ? error.message : String(error),
        errorType: error instanceof Error ? error.constructor.name : 'unknown'
      });
      throw new Error(`Failed to execute list_messages: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /* DEBUG: endpoint={"name":"get_message","method":"GET","path":"/users/{userId}/messages/{id}","description":"Get a specific message by ID","parameters":{"userId":{"type":"string","required":false,"description":"User's email address or 'me' for authenticated user","location":"path"},"id":{"type":"string","required":true,"description":"Message ID to retrieve","location":"path"},"format":{"type":"string","required":false,"description":"Format of message (full, metadata, minimal, raw)","location":"query"},"metadataHeaders":{"type":"string","required":false,"description":"Comma-separated list of header names to include when format=metadata","location":"query"}},"response_format":"json","category":"Email Management"} */
  async getMessage(params: any, options?: RequestOptions): Promise<any> {
    const startTime = Date.now();
    this.logger.info('ENDPOINT_START', 'Endpoint execution started', {
      endpoint: 'get_message',
      method: 'GET',
      path: '/users/{userId}/messages/{id}',
      paramCount: Object.keys(params || {}).length,
      paramKeys: Object.keys(params || {})
    });
    
    try {
      
      // Extract and separate parameters by location: path, query, body
      const pathTemplate = '/users/{userId}/messages/{id}';
      const pathParams: Record<string, any> = {};
      const queryParams: Record<string, any> = {};
      const bodyParams: Record<string, any> = {};
      const extractedParams: string[] = [];
      
      // Handle Google-style path templates: {resourceName=people/*} and {person.resourceName=people/*}
      const googlePathTemplateRegex = /{([^}=]+)=[^}]*}/g;
      let match;
      
      while ((match = googlePathTemplateRegex.exec(pathTemplate)) !== null) {
        const paramName = match[1]; // e.g., "resourceName" or "person.resourceName"
        if (paramName && params[paramName] !== undefined) {
          pathParams[paramName] = params[paramName];
          extractedParams.push(paramName);
        }
      }
      
      // Handle standard path templates: {resourceName}
      const standardPathParams = pathTemplate.match(/{([^}=]+)}/g) || [];
      standardPathParams.forEach(paramTemplate => {
        const paramName = paramTemplate.slice(1, -1); // Remove { }
        // Only process if not already handled by Google template logic
        if (!extractedParams.includes(paramName)) {
          if (params[paramName] !== undefined) {
            pathParams[paramName] = params[paramName];
            extractedParams.push(paramName);
          } else {
            // Provide default values for optional path parameters
            if (paramName === 'userId') {
              pathParams[paramName] = 'me'; // Default to authenticated user
              extractedParams.push(paramName);
            }
          }
        }
      });
      
      // Check if any parameter has raw_array flag
      let hasRawArrayBody = false;
      let rawBodyData: any = undefined;
      
      // Separate remaining parameters by location (query vs body)
      if (params[""] !== undefined) {
        queryParams[""] = params[""];
        extractedParams.push("");
      }
      if (params[""] !== undefined) {
        queryParams[""] = params[""];
        extractedParams.push("");
      }
      
      // Any remaining unprocessed parameters default to body for backward compatibility
      for (const [key, value] of Object.entries(params)) {
        if (!extractedParams.includes(key)) {
          bodyParams[key] = value;
        }
      }
      
      // Validate required parameters
      
      const path = this.buildPath('/users/{userId}/messages/{id}', pathParams);
      // For GraphQL endpoints that use '/' as the path, use empty string to avoid double slash
      const requestPath = path === '/' ? '' : path;
      
      // Report initial progress if callback provided
      if (options?.onProgress) {
        await options.onProgress({
          progress: 0,
          total: 100,
          message: `Starting get_message request...`
        });
      }
      
      // Use authenticated request for OAuth (both ConstructionWire and standard OAuth)
      const response = await this.makeAuthenticatedRequest({ method: 'GET', url: path, params: queryParams }, options);
      
      // Report completion progress if callback provided
      if (options?.onProgress) {
        await options.onProgress({
          progress: 100,
          total: 100,
          message: `Completed get_message request`
        });
      }
      
      const duration = Date.now() - startTime;
      this.logger.info('ENDPOINT_SUCCESS', 'Endpoint execution completed successfully', {
        endpoint: 'get_message',
        method: 'GET',
        path: '/users/{userId}/messages/{id}',
        duration_ms: duration,
        responseDataSize: JSON.stringify(response.data).length
      });
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response.data, null, 2)
          }
        ]
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      
      // Check if error is due to cancellation
      if (axios.isCancel(error)) {
        this.logger.info('REQUEST_CANCELLED', 'Request was cancelled', {
          endpoint: 'get_message',
          method: 'GET',
          path: '/users/{userId}/messages/{id}',
          duration_ms: duration
        });
        throw new Error('Request was cancelled');
      }
      
      this.logger.error('ENDPOINT_ERROR', 'Endpoint execution failed', {
        endpoint: 'get_message',
        method: 'GET',
        path: '/users/{userId}/messages/{id}',
        duration_ms: duration,
        error: error instanceof Error ? error.message : String(error),
        errorType: error instanceof Error ? error.constructor.name : 'unknown'
      });
      throw new Error(`Failed to execute get_message: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /* DEBUG: endpoint={"name":"send_message","method":"POST","path":"/users/{userId}/messages/send","description":"Send an email message. Requires message in RFC 2822 format encoded as base64url string","parameters":{"userId":{"type":"string","required":false,"description":"User's email address or 'me' for authenticated user","location":"path"},"raw":{"type":"string","required":true,"description":"RFC 2822 formatted and base64url encoded email message","location":"body"}},"response_format":"json","category":"Email Management"} */
  async sendMessage(params: any, options?: RequestOptions): Promise<any> {
    const startTime = Date.now();
    this.logger.info('ENDPOINT_START', 'Endpoint execution started', {
      endpoint: 'send_message',
      method: 'POST',
      path: '/users/{userId}/messages/send',
      paramCount: Object.keys(params || {}).length,
      paramKeys: Object.keys(params || {})
    });
    
    try {
      
      // Extract and separate parameters by location: path, query, body
      const pathTemplate = '/users/{userId}/messages/send';
      const pathParams: Record<string, any> = {};
      const queryParams: Record<string, any> = {};
      const bodyParams: Record<string, any> = {};
      const extractedParams: string[] = [];
      
      // Handle Google-style path templates: {resourceName=people/*} and {person.resourceName=people/*}
      const googlePathTemplateRegex = /{([^}=]+)=[^}]*}/g;
      let match;
      
      while ((match = googlePathTemplateRegex.exec(pathTemplate)) !== null) {
        const paramName = match[1]; // e.g., "resourceName" or "person.resourceName"
        if (paramName && params[paramName] !== undefined) {
          pathParams[paramName] = params[paramName];
          extractedParams.push(paramName);
        }
      }
      
      // Handle standard path templates: {resourceName}
      const standardPathParams = pathTemplate.match(/{([^}=]+)}/g) || [];
      standardPathParams.forEach(paramTemplate => {
        const paramName = paramTemplate.slice(1, -1); // Remove { }
        // Only process if not already handled by Google template logic
        if (!extractedParams.includes(paramName)) {
          if (params[paramName] !== undefined) {
            pathParams[paramName] = params[paramName];
            extractedParams.push(paramName);
          } else {
            // Provide default values for optional path parameters
            if (paramName === 'userId') {
              pathParams[paramName] = 'me'; // Default to authenticated user
              extractedParams.push(paramName);
            }
          }
        }
      });
      
      // Check if any parameter has raw_array flag
      let hasRawArrayBody = false;
      let rawBodyData: any = undefined;
      
      // Separate remaining parameters by location (query vs body)
      if (params[""] !== undefined) {
        bodyParams[""] = params[""];
        extractedParams.push("");
      }
            
      // Any remaining unprocessed parameters default to body for backward compatibility
      for (const [key, value] of Object.entries(params)) {
        if (!extractedParams.includes(key)) {
          bodyParams[key] = value;
        }
      }
      
      // Validate required parameters
      
      const path = this.buildPath('/users/{userId}/messages/send', pathParams);
      // For GraphQL endpoints that use '/' as the path, use empty string to avoid double slash
      const requestPath = path === '/' ? '' : path;
      
      // Report initial progress if callback provided
      if (options?.onProgress) {
        await options.onProgress({
          progress: 0,
          total: 100,
          message: `Starting send_message request...`
        });
      }
      
      // Use authenticated request for OAuth (both ConstructionWire and standard OAuth)
      const response = await this.makeAuthenticatedRequest({ method: 'POST', url: path, params: queryParams, data: hasRawArrayBody ? rawBodyData : (Object.keys(bodyParams).length > 0 ? bodyParams : undefined) }, options);
      
      // Report completion progress if callback provided
      if (options?.onProgress) {
        await options.onProgress({
          progress: 100,
          total: 100,
          message: `Completed send_message request`
        });
      }
      
      const duration = Date.now() - startTime;
      this.logger.info('ENDPOINT_SUCCESS', 'Endpoint execution completed successfully', {
        endpoint: 'send_message',
        method: 'POST',
        path: '/users/{userId}/messages/send',
        duration_ms: duration,
        responseDataSize: JSON.stringify(response.data).length
      });
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response.data, null, 2)
          }
        ]
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      
      // Check if error is due to cancellation
      if (axios.isCancel(error)) {
        this.logger.info('REQUEST_CANCELLED', 'Request was cancelled', {
          endpoint: 'send_message',
          method: 'POST',
          path: '/users/{userId}/messages/send',
          duration_ms: duration
        });
        throw new Error('Request was cancelled');
      }
      
      this.logger.error('ENDPOINT_ERROR', 'Endpoint execution failed', {
        endpoint: 'send_message',
        method: 'POST',
        path: '/users/{userId}/messages/send',
        duration_ms: duration,
        error: error instanceof Error ? error.message : String(error),
        errorType: error instanceof Error ? error.constructor.name : 'unknown'
      });
      throw new Error(`Failed to execute send_message: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /* DEBUG: endpoint={"name":"create_draft","method":"POST","path":"/users/{userId}/drafts","description":"Create a new draft message. IMPORTANT: Message must be an object with 'raw' field containing base64url-encoded RFC 2822 formatted message.","parameters":{"userId":{"type":"string","required":false,"description":"User's email address or 'me' for authenticated user","location":"path"},"message":{"type":"object","required":true,"description":"Message object containing draft content","location":"body","properties":{"raw":{"type":"string","required":true,"description":"RFC 2822 formatted message encoded as base64url string. Create using email.mime libraries then base64url encode."}}}},"response_format":"json","category":"Email Management"} */
  async createDraft(params: any, options?: RequestOptions): Promise<any> {
    const startTime = Date.now();
    this.logger.info('ENDPOINT_START', 'Endpoint execution started', {
      endpoint: 'create_draft',
      method: 'POST',
      path: '/users/{userId}/drafts',
      paramCount: Object.keys(params || {}).length,
      paramKeys: Object.keys(params || {})
    });
    
    try {
      
      // Extract and separate parameters by location: path, query, body
      const pathTemplate = '/users/{userId}/drafts';
      const pathParams: Record<string, any> = {};
      const queryParams: Record<string, any> = {};
      const bodyParams: Record<string, any> = {};
      const extractedParams: string[] = [];
      
      // Handle Google-style path templates: {resourceName=people/*} and {person.resourceName=people/*}
      const googlePathTemplateRegex = /{([^}=]+)=[^}]*}/g;
      let match;
      
      while ((match = googlePathTemplateRegex.exec(pathTemplate)) !== null) {
        const paramName = match[1]; // e.g., "resourceName" or "person.resourceName"
        if (paramName && params[paramName] !== undefined) {
          pathParams[paramName] = params[paramName];
          extractedParams.push(paramName);
        }
      }
      
      // Handle standard path templates: {resourceName}
      const standardPathParams = pathTemplate.match(/{([^}=]+)}/g) || [];
      standardPathParams.forEach(paramTemplate => {
        const paramName = paramTemplate.slice(1, -1); // Remove { }
        // Only process if not already handled by Google template logic
        if (!extractedParams.includes(paramName)) {
          if (params[paramName] !== undefined) {
            pathParams[paramName] = params[paramName];
            extractedParams.push(paramName);
          } else {
            // Provide default values for optional path parameters
            if (paramName === 'userId') {
              pathParams[paramName] = 'me'; // Default to authenticated user
              extractedParams.push(paramName);
            }
          }
        }
      });
      
      // Check if any parameter has raw_array flag
      let hasRawArrayBody = false;
      let rawBodyData: any = undefined;
      
      // Separate remaining parameters by location (query vs body)
      if (params[""] !== undefined) {
        bodyParams[""] = params[""];
        extractedParams.push("");
      }
            
      // Any remaining unprocessed parameters default to body for backward compatibility
      for (const [key, value] of Object.entries(params)) {
        if (!extractedParams.includes(key)) {
          bodyParams[key] = value;
        }
      }
      
      // Validate required parameters
      
      const path = this.buildPath('/users/{userId}/drafts', pathParams);
      // For GraphQL endpoints that use '/' as the path, use empty string to avoid double slash
      const requestPath = path === '/' ? '' : path;
      
      // Report initial progress if callback provided
      if (options?.onProgress) {
        await options.onProgress({
          progress: 0,
          total: 100,
          message: `Starting create_draft request...`
        });
      }
      
      // Use authenticated request for OAuth (both ConstructionWire and standard OAuth)
      const response = await this.makeAuthenticatedRequest({ method: 'POST', url: path, params: queryParams, data: hasRawArrayBody ? rawBodyData : (Object.keys(bodyParams).length > 0 ? bodyParams : undefined) }, options);
      
      // Report completion progress if callback provided
      if (options?.onProgress) {
        await options.onProgress({
          progress: 100,
          total: 100,
          message: `Completed create_draft request`
        });
      }
      
      const duration = Date.now() - startTime;
      this.logger.info('ENDPOINT_SUCCESS', 'Endpoint execution completed successfully', {
        endpoint: 'create_draft',
        method: 'POST',
        path: '/users/{userId}/drafts',
        duration_ms: duration,
        responseDataSize: JSON.stringify(response.data).length
      });
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response.data, null, 2)
          }
        ]
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      
      // Check if error is due to cancellation
      if (axios.isCancel(error)) {
        this.logger.info('REQUEST_CANCELLED', 'Request was cancelled', {
          endpoint: 'create_draft',
          method: 'POST',
          path: '/users/{userId}/drafts',
          duration_ms: duration
        });
        throw new Error('Request was cancelled');
      }
      
      this.logger.error('ENDPOINT_ERROR', 'Endpoint execution failed', {
        endpoint: 'create_draft',
        method: 'POST',
        path: '/users/{userId}/drafts',
        duration_ms: duration,
        error: error instanceof Error ? error.message : String(error),
        errorType: error instanceof Error ? error.constructor.name : 'unknown'
      });
      throw new Error(`Failed to execute create_draft: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /* DEBUG: endpoint={"name":"delete_message","method":"DELETE","path":"/users/{userId}/messages/{id}","description":"PERMANENTLY delete a message - IMMEDIATE and IRREVERSIBLE. WARNING: Use trash_message instead for normal email deletion. Only use this for sensitive data that must be immediately destroyed. Bypasses trash completely. REQUIRES https://mail.google.com/ scope. Returns 204 No Content with empty body on success.","parameters":{"userId":{"type":"string","required":false,"description":"User's email address or 'me' for authenticated user","location":"path"},"id":{"type":"string","required":true,"description":"Message ID to PERMANENTLY DELETE (immediate and irreversible)","location":"path"}},"response_format":"empty","success_status":204,"category":"Email Management"} */
  async deleteMessage(params: any, options?: RequestOptions): Promise<any> {
    const startTime = Date.now();
    this.logger.info('ENDPOINT_START', 'Endpoint execution started', {
      endpoint: 'delete_message',
      method: 'DELETE',
      path: '/users/{userId}/messages/{id}',
      paramCount: Object.keys(params || {}).length,
      paramKeys: Object.keys(params || {})
    });
    
    try {
      
      // Extract and separate parameters by location: path, query, body
      const pathTemplate = '/users/{userId}/messages/{id}';
      const pathParams: Record<string, any> = {};
      const queryParams: Record<string, any> = {};
      const bodyParams: Record<string, any> = {};
      const extractedParams: string[] = [];
      
      // Handle Google-style path templates: {resourceName=people/*} and {person.resourceName=people/*}
      const googlePathTemplateRegex = /{([^}=]+)=[^}]*}/g;
      let match;
      
      while ((match = googlePathTemplateRegex.exec(pathTemplate)) !== null) {
        const paramName = match[1]; // e.g., "resourceName" or "person.resourceName"
        if (paramName && params[paramName] !== undefined) {
          pathParams[paramName] = params[paramName];
          extractedParams.push(paramName);
        }
      }
      
      // Handle standard path templates: {resourceName}
      const standardPathParams = pathTemplate.match(/{([^}=]+)}/g) || [];
      standardPathParams.forEach(paramTemplate => {
        const paramName = paramTemplate.slice(1, -1); // Remove { }
        // Only process if not already handled by Google template logic
        if (!extractedParams.includes(paramName)) {
          if (params[paramName] !== undefined) {
            pathParams[paramName] = params[paramName];
            extractedParams.push(paramName);
          } else {
            // Provide default values for optional path parameters
            if (paramName === 'userId') {
              pathParams[paramName] = 'me'; // Default to authenticated user
              extractedParams.push(paramName);
            }
          }
        }
      });
      
      // Check if any parameter has raw_array flag
      let hasRawArrayBody = false;
      let rawBodyData: any = undefined;
      
      // Separate remaining parameters by location (query vs body)
      
      // Any remaining unprocessed parameters default to body for backward compatibility
      for (const [key, value] of Object.entries(params)) {
        if (!extractedParams.includes(key)) {
          bodyParams[key] = value;
        }
      }
      
      // Validate required parameters
      
      const path = this.buildPath('/users/{userId}/messages/{id}', pathParams);
      // For GraphQL endpoints that use '/' as the path, use empty string to avoid double slash
      const requestPath = path === '/' ? '' : path;
      
      // Report initial progress if callback provided
      if (options?.onProgress) {
        await options.onProgress({
          progress: 0,
          total: 100,
          message: `Starting delete_message request...`
        });
      }
      
      // Use authenticated request for OAuth (both ConstructionWire and standard OAuth)
      const response = await this.makeAuthenticatedRequest({ method: 'DELETE', url: path, params: queryParams }, options);
      
      // Report completion progress if callback provided
      if (options?.onProgress) {
        await options.onProgress({
          progress: 100,
          total: 100,
          message: `Completed delete_message request`
        });
      }
      
      const duration = Date.now() - startTime;
      this.logger.info('ENDPOINT_SUCCESS', 'Endpoint execution completed successfully', {
        endpoint: 'delete_message',
        method: 'DELETE',
        path: '/users/{userId}/messages/{id}',
        duration_ms: duration,
        responseDataSize: JSON.stringify(response.data).length
      });
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response.data, null, 2)
          }
        ]
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      
      // Check if error is due to cancellation
      if (axios.isCancel(error)) {
        this.logger.info('REQUEST_CANCELLED', 'Request was cancelled', {
          endpoint: 'delete_message',
          method: 'DELETE',
          path: '/users/{userId}/messages/{id}',
          duration_ms: duration
        });
        throw new Error('Request was cancelled');
      }
      
      this.logger.error('ENDPOINT_ERROR', 'Endpoint execution failed', {
        endpoint: 'delete_message',
        method: 'DELETE',
        path: '/users/{userId}/messages/{id}',
        duration_ms: duration,
        error: error instanceof Error ? error.message : String(error),
        errorType: error instanceof Error ? error.constructor.name : 'unknown'
      });
      throw new Error(`Failed to execute delete_message: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /* DEBUG: endpoint={"name":"modify_message","method":"POST","path":"/users/{userId}/messages/{id}/modify","description":"Modify labels on a message (add/remove labels, mark read/unread)","parameters":{"userId":{"type":"string","required":false,"description":"User's email address or 'me' for authenticated user","location":"path"},"id":{"type":"string","required":true,"description":"Message ID to modify","location":"path"},"addLabelIds":{"type":"string","required":false,"description":"Comma-separated list of label IDs to add","location":"body"},"removeLabelIds":{"type":"string","required":false,"description":"Comma-separated list of label IDs to remove","location":"body"}},"response_format":"json","category":"Email Management"} */
  async modifyMessage(params: any, options?: RequestOptions): Promise<any> {
    const startTime = Date.now();
    this.logger.info('ENDPOINT_START', 'Endpoint execution started', {
      endpoint: 'modify_message',
      method: 'POST',
      path: '/users/{userId}/messages/{id}/modify',
      paramCount: Object.keys(params || {}).length,
      paramKeys: Object.keys(params || {})
    });
    
    try {
      
      // Extract and separate parameters by location: path, query, body
      const pathTemplate = '/users/{userId}/messages/{id}/modify';
      const pathParams: Record<string, any> = {};
      const queryParams: Record<string, any> = {};
      const bodyParams: Record<string, any> = {};
      const extractedParams: string[] = [];
      
      // Handle Google-style path templates: {resourceName=people/*} and {person.resourceName=people/*}
      const googlePathTemplateRegex = /{([^}=]+)=[^}]*}/g;
      let match;
      
      while ((match = googlePathTemplateRegex.exec(pathTemplate)) !== null) {
        const paramName = match[1]; // e.g., "resourceName" or "person.resourceName"
        if (paramName && params[paramName] !== undefined) {
          pathParams[paramName] = params[paramName];
          extractedParams.push(paramName);
        }
      }
      
      // Handle standard path templates: {resourceName}
      const standardPathParams = pathTemplate.match(/{([^}=]+)}/g) || [];
      standardPathParams.forEach(paramTemplate => {
        const paramName = paramTemplate.slice(1, -1); // Remove { }
        // Only process if not already handled by Google template logic
        if (!extractedParams.includes(paramName)) {
          if (params[paramName] !== undefined) {
            pathParams[paramName] = params[paramName];
            extractedParams.push(paramName);
          } else {
            // Provide default values for optional path parameters
            if (paramName === 'userId') {
              pathParams[paramName] = 'me'; // Default to authenticated user
              extractedParams.push(paramName);
            }
          }
        }
      });
      
      // Check if any parameter has raw_array flag
      let hasRawArrayBody = false;
      let rawBodyData: any = undefined;
      
      // Separate remaining parameters by location (query vs body)
      if (params[""] !== undefined) {
        bodyParams[""] = params[""];
        extractedParams.push("");
      }
            if (params[""] !== undefined) {
        bodyParams[""] = params[""];
        extractedParams.push("");
      }
            
      // Any remaining unprocessed parameters default to body for backward compatibility
      for (const [key, value] of Object.entries(params)) {
        if (!extractedParams.includes(key)) {
          bodyParams[key] = value;
        }
      }
      
      // Validate required parameters
      
      const path = this.buildPath('/users/{userId}/messages/{id}/modify', pathParams);
      // For GraphQL endpoints that use '/' as the path, use empty string to avoid double slash
      const requestPath = path === '/' ? '' : path;
      
      // Report initial progress if callback provided
      if (options?.onProgress) {
        await options.onProgress({
          progress: 0,
          total: 100,
          message: `Starting modify_message request...`
        });
      }
      
      // Use authenticated request for OAuth (both ConstructionWire and standard OAuth)
      const response = await this.makeAuthenticatedRequest({ method: 'POST', url: path, params: queryParams, data: hasRawArrayBody ? rawBodyData : (Object.keys(bodyParams).length > 0 ? bodyParams : undefined) }, options);
      
      // Report completion progress if callback provided
      if (options?.onProgress) {
        await options.onProgress({
          progress: 100,
          total: 100,
          message: `Completed modify_message request`
        });
      }
      
      const duration = Date.now() - startTime;
      this.logger.info('ENDPOINT_SUCCESS', 'Endpoint execution completed successfully', {
        endpoint: 'modify_message',
        method: 'POST',
        path: '/users/{userId}/messages/{id}/modify',
        duration_ms: duration,
        responseDataSize: JSON.stringify(response.data).length
      });
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response.data, null, 2)
          }
        ]
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      
      // Check if error is due to cancellation
      if (axios.isCancel(error)) {
        this.logger.info('REQUEST_CANCELLED', 'Request was cancelled', {
          endpoint: 'modify_message',
          method: 'POST',
          path: '/users/{userId}/messages/{id}/modify',
          duration_ms: duration
        });
        throw new Error('Request was cancelled');
      }
      
      this.logger.error('ENDPOINT_ERROR', 'Endpoint execution failed', {
        endpoint: 'modify_message',
        method: 'POST',
        path: '/users/{userId}/messages/{id}/modify',
        duration_ms: duration,
        error: error instanceof Error ? error.message : String(error),
        errorType: error instanceof Error ? error.constructor.name : 'unknown'
      });
      throw new Error(`Failed to execute modify_message: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /* DEBUG: endpoint={"name":"search_messages","description":"search_messages endpoint for google-gmail","inputSchema":{"type":"object","properties":{},"required":[]}} */
  async searchMessages(params: any, options?: RequestOptions): Promise<any> {
    const startTime = Date.now();
    this.logger.info('ENDPOINT_START', 'Endpoint execution started', {
      endpoint: 'search_messages',
      method: '',
      path: '',
      paramCount: Object.keys(params || {}).length,
      paramKeys: Object.keys(params || {})
    });
    
    try {
      
      // Extract and separate parameters by location: path, query, body
      const pathTemplate = '';
      const pathParams: Record<string, any> = {};
      const queryParams: Record<string, any> = {};
      const bodyParams: Record<string, any> = {};
      const extractedParams: string[] = [];
      
      // Handle Google-style path templates: {resourceName=people/*} and {person.resourceName=people/*}
      const googlePathTemplateRegex = /{([^}=]+)=[^}]*}/g;
      let match;
      
      while ((match = googlePathTemplateRegex.exec(pathTemplate)) !== null) {
        const paramName = match[1]; // e.g., "resourceName" or "person.resourceName"
        if (paramName && params[paramName] !== undefined) {
          pathParams[paramName] = params[paramName];
          extractedParams.push(paramName);
        }
      }
      
      // Handle standard path templates: {resourceName}
      const standardPathParams = pathTemplate.match(/{([^}=]+)}/g) || [];
      standardPathParams.forEach(paramTemplate => {
        const paramName = paramTemplate.slice(1, -1); // Remove { }
        // Only process if not already handled by Google template logic
        if (!extractedParams.includes(paramName)) {
          if (params[paramName] !== undefined) {
            pathParams[paramName] = params[paramName];
            extractedParams.push(paramName);
          } else {
            // Provide default values for optional path parameters
            if (paramName === 'userId') {
              pathParams[paramName] = 'me'; // Default to authenticated user
              extractedParams.push(paramName);
            }
          }
        }
      });
      
      
      // Any remaining unprocessed parameters default to body for backward compatibility
      for (const [key, value] of Object.entries(params)) {
        if (!extractedParams.includes(key)) {
          bodyParams[key] = value;
        }
      }
      
      
      const path = this.buildPath('', pathParams);
      // For GraphQL endpoints that use '/' as the path, use empty string to avoid double slash
      const requestPath = path === '/' ? '' : path;
      
      // Report initial progress if callback provided
      if (options?.onProgress) {
        await options.onProgress({
          progress: 0,
          total: 100,
          message: `Starting search_messages request...`
        });
      }
      
      // Use authenticated request for OAuth (both ConstructionWire and standard OAuth)
      const response = await this.makeAuthenticatedRequest({ method: 'GET', url: path, params: queryParams }, options);
            
      // Report completion progress if callback provided
      if (options?.onProgress) {
        await options.onProgress({
          progress: 100,
          total: 100,
          message: `Completed search_messages request`
        });
      }
      
      const duration = Date.now() - startTime;
      this.logger.info('ENDPOINT_SUCCESS', 'Endpoint execution completed successfully', {
        endpoint: 'search_messages',
        method: '',
        path: '',
        duration_ms: duration,
        responseDataSize: JSON.stringify(response.data).length
      });
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response.data, null, 2)
          }
        ]
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      
      // Check if error is due to cancellation
      if (axios.isCancel(error)) {
        this.logger.info('REQUEST_CANCELLED', 'Request was cancelled', {
          endpoint: 'search_messages',
          method: '',
          path: '',
          duration_ms: duration
        });
        throw new Error('Request was cancelled');
      }
      
      this.logger.error('ENDPOINT_ERROR', 'Endpoint execution failed', {
        endpoint: 'search_messages',
        method: '',
        path: '',
        duration_ms: duration,
        error: error instanceof Error ? error.message : String(error),
        errorType: error instanceof Error ? error.constructor.name : 'unknown'
      });
      throw new Error(`Failed to execute search_messages: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

}