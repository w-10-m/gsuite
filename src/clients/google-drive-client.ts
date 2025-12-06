import axios, { AxiosInstance } from 'axios';
import { Logger } from '../services/logger.js';
import { RequestOptions, ProgressCallback } from '../types.js';

export interface GoogleDriveClientConfig {
  gOOGLEOAUTHCREDENTIALS?: string;
  scopes?: any;
  timeout?: number;
  rateLimit?: number; // requests per minute
  authToken?: string;
  logger?: Logger;
  oauthClient?: any; // OAuth client for token management
}

export class GoogleDriveClient {
  private httpClient: AxiosInstance;
  private config: GoogleDriveClientConfig;
  private sessionId: string;
  private logger: Logger;
  private oauthClient: any; // OAuth client for token management
  
  constructor(config: GoogleDriveClientConfig) {
    this.config = config;
    
    // Generate unique session ID for this client instance
    this.sessionId = `google-drive-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    
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
    // console.error('[GoogleDriveClient] Resolving base URL...');
    // console.error('[GoogleDriveClient] Template base_url:', 'https://www.googleapis.com');
    // console.error('[GoogleDriveClient] CustomConfig baseUrl:', '');
    
    let baseUrl = 'https://www.googleapis.com';
    
    // console.error('[GoogleDriveClient] Initial resolved baseUrl:', baseUrl);
    
    // If no base URL was found, throw an error
    if (!baseUrl) {
      throw new Error(`No base URL configured for google-drive. Please provide base_url in template or customConfig.baseUrl.`);
    }
    
    // Handle dynamic domain replacement for patterns like CONFLUENCE_DOMAIN, JIRA_DOMAIN, etc.
    const domainEnvVar = `GOOGLE-DRIVE_DOMAIN`;
    const domain = process.env[domainEnvVar];
    // console.error(`[GoogleDriveClient] Domain env var (${domainEnvVar}):`, domain);
    
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
        template: 'google-drive',
        baseUrl: baseUrl
      });
    }
    
    // console.error('[GoogleDriveClient] Final resolved baseUrl:', baseUrl);
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

  /* DEBUG: endpoint={"name":"list_files","method":"GET","path":"/drive/v3/files","description":"List files in Google Drive with optional search query and filtering","parameters":{"q":{"type":"string","required":false,"description":"Search query using Drive query syntax (e.g., 'name contains \"test\"', 'mimeType=\"application/pdf\"', 'parents in \"folderId\"')","location":"query"},"pageSize":{"type":"number","required":false,"description":"Maximum number of files to return (default 100, max 1000)","location":"query"},"pageToken":{"type":"string","required":false,"description":"Page token for pagination","location":"query"},"fields":{"type":"string","required":false,"description":"Fields to return - IMPORTANT: Must use format 'files(id,name,mimeType,size,modifiedTime,parents,webViewLink)' for list endpoints. Do NOT use 'id,name,mimeType' format.","location":"query"},"orderBy":{"type":"string","required":false,"description":"Sort order: 'createdTime', 'folder', 'modifiedByMeTime', 'modifiedTime', 'name', 'quotaBytesUsed', 'recency', 'sharedWithMeTime', 'starred', 'viewedByMeTime'","location":"query"},"spaces":{"type":"string","required":false,"description":"Comma-separated list of spaces to query: 'drive', 'appDataFolder', 'photos'","location":"query"},"corpora":{"type":"string","required":false,"description":"Corpora to search: 'user' (default), 'domain', 'drive', 'allDrives'","location":"query"},"driveId":{"type":"string","required":false,"description":"ID of the shared drive to search (if corpora is 'drive')","location":"query"},"includeItemsFromAllDrives":{"type":"boolean","required":false,"description":"Whether to include files from all drives","location":"query"},"supportsAllDrives":{"type":"boolean","required":false,"description":"Whether to support files in shared drives","location":"query"},"includePermissionsForView":{"type":"string","required":false,"description":"Specifies which additional view's permissions to include ('published')","location":"query"},"includeLabels":{"type":"string","required":false,"description":"Comma-separated list of label IDs to include","location":"query"}},"response_format":"json","category":"Search & Organization"} */
  async listFiles(params: any, options?: RequestOptions): Promise<any> {
    const startTime = Date.now();
    this.logger.info('ENDPOINT_START', 'Endpoint execution started', {
      endpoint: 'list_files',
      method: 'GET',
      path: '/drive/v3/files',
      paramCount: Object.keys(params || {}).length,
      paramKeys: Object.keys(params || {})
    });
    
    try {
      
      // Extract and separate parameters by location: path, query, body
      const pathTemplate = '/drive/v3/files';
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
      
      const path = this.buildPath('/drive/v3/files', pathParams);
      // For GraphQL endpoints that use '/' as the path, use empty string to avoid double slash
      const requestPath = path === '/' ? '' : path;
      
      // Report initial progress if callback provided
      if (options?.onProgress) {
        await options.onProgress({
          progress: 0,
          total: 100,
          message: `Starting list_files request...`
        });
      }
      
      // Use authenticated request for OAuth (both ConstructionWire and standard OAuth)
      const response = await this.makeAuthenticatedRequest({ method: 'GET', url: path, params: queryParams }, options);
      
      // Report completion progress if callback provided
      if (options?.onProgress) {
        await options.onProgress({
          progress: 100,
          total: 100,
          message: `Completed list_files request`
        });
      }
      
      const duration = Date.now() - startTime;
      this.logger.info('ENDPOINT_SUCCESS', 'Endpoint execution completed successfully', {
        endpoint: 'list_files',
        method: 'GET',
        path: '/drive/v3/files',
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
          endpoint: 'list_files',
          method: 'GET',
          path: '/drive/v3/files',
          duration_ms: duration
        });
        throw new Error('Request was cancelled');
      }
      
      this.logger.error('ENDPOINT_ERROR', 'Endpoint execution failed', {
        endpoint: 'list_files',
        method: 'GET',
        path: '/drive/v3/files',
        duration_ms: duration,
        error: error instanceof Error ? error.message : String(error),
        errorType: error instanceof Error ? error.constructor.name : 'unknown'
      });
      throw new Error(`Failed to execute list_files: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /* DEBUG: endpoint={"name":"get_file","method":"GET","path":"/drive/v3/files/{fileId}","description":"Get file metadata by ID","parameters":{"fileId":{"type":"string","required":true,"description":"ID of the file to retrieve","location":"path"},"fields":{"type":"string","required":false,"description":"Comma-separated list of fields to return (e.g., 'id,name,mimeType,size,parents,modifiedTime,createdTime,webViewLink'). For single items, use direct field names.","location":"query"},"supportsAllDrives":{"type":"boolean","required":false,"description":"Whether to support files in shared drives","location":"query"},"acknowledgeAbuse":{"type":"boolean","required":false,"description":"Whether to acknowledge virus scan warnings","location":"query"}},"response_format":"json","category":"File Management"} */
  async getFile(params: any, options?: RequestOptions): Promise<any> {
    const startTime = Date.now();
    this.logger.info('ENDPOINT_START', 'Endpoint execution started', {
      endpoint: 'get_file',
      method: 'GET',
      path: '/drive/v3/files/{fileId}',
      paramCount: Object.keys(params || {}).length,
      paramKeys: Object.keys(params || {})
    });
    
    try {
      
      // Extract and separate parameters by location: path, query, body
      const pathTemplate = '/drive/v3/files/{fileId}';
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
      
      // Any remaining unprocessed parameters default to body for backward compatibility
      for (const [key, value] of Object.entries(params)) {
        if (!extractedParams.includes(key)) {
          bodyParams[key] = value;
        }
      }
      
      // Validate required parameters
      
      const path = this.buildPath('/drive/v3/files/{fileId}', pathParams);
      // For GraphQL endpoints that use '/' as the path, use empty string to avoid double slash
      const requestPath = path === '/' ? '' : path;
      
      // Report initial progress if callback provided
      if (options?.onProgress) {
        await options.onProgress({
          progress: 0,
          total: 100,
          message: `Starting get_file request...`
        });
      }
      
      // Use authenticated request for OAuth (both ConstructionWire and standard OAuth)
      const response = await this.makeAuthenticatedRequest({ method: 'GET', url: path, params: queryParams }, options);
      
      // Report completion progress if callback provided
      if (options?.onProgress) {
        await options.onProgress({
          progress: 100,
          total: 100,
          message: `Completed get_file request`
        });
      }
      
      const duration = Date.now() - startTime;
      this.logger.info('ENDPOINT_SUCCESS', 'Endpoint execution completed successfully', {
        endpoint: 'get_file',
        method: 'GET',
        path: '/drive/v3/files/{fileId}',
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
          endpoint: 'get_file',
          method: 'GET',
          path: '/drive/v3/files/{fileId}',
          duration_ms: duration
        });
        throw new Error('Request was cancelled');
      }
      
      this.logger.error('ENDPOINT_ERROR', 'Endpoint execution failed', {
        endpoint: 'get_file',
        method: 'GET',
        path: '/drive/v3/files/{fileId}',
        duration_ms: duration,
        error: error instanceof Error ? error.message : String(error),
        errorType: error instanceof Error ? error.constructor.name : 'unknown'
      });
      throw new Error(`Failed to execute get_file: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /* DEBUG: endpoint={"name":"update_file","method":"PATCH","path":"/drive/v3/files/{fileId}","description":"Update file metadata","parameters":{"fileId":{"type":"string","required":true,"description":"ID of the file to update","location":"path"},"fields":{"type":"string","required":false,"description":"Comma-separated list of fields to return in response","location":"query"},"supportsAllDrives":{"type":"boolean","required":false,"description":"Whether to support files in shared drives","location":"query"},"name":{"type":"string","required":false,"description":"New name for the file","location":"body"},"description":{"type":"string","required":false,"description":"New description for the file","location":"body"},"parents":{"type":"object","required":false,"description":"Array of parent folder IDs","location":"body"},"starred":{"type":"boolean","required":false,"description":"Whether to star the file","location":"body"},"trashed":{"type":"boolean","required":false,"description":"Whether to move the file to trash","location":"body"}},"response_format":"json","category":"File Management"} */
  async updateFile(params: any, options?: RequestOptions): Promise<any> {
    const startTime = Date.now();
    this.logger.info('ENDPOINT_START', 'Endpoint execution started', {
      endpoint: 'update_file',
      method: 'PATCH',
      path: '/drive/v3/files/{fileId}',
      paramCount: Object.keys(params || {}).length,
      paramKeys: Object.keys(params || {})
    });
    
    try {
      
      // Extract and separate parameters by location: path, query, body
      const pathTemplate = '/drive/v3/files/{fileId}';
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
        bodyParams[""] = params[""];
        extractedParams.push("");
      }
            if (params[""] !== undefined) {
        bodyParams[""] = params[""];
        extractedParams.push("");
      }
            if (params[""] !== undefined) {
        bodyParams[""] = params[""];
        extractedParams.push("");
      }
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
      
      const path = this.buildPath('/drive/v3/files/{fileId}', pathParams);
      // For GraphQL endpoints that use '/' as the path, use empty string to avoid double slash
      const requestPath = path === '/' ? '' : path;
      
      // Report initial progress if callback provided
      if (options?.onProgress) {
        await options.onProgress({
          progress: 0,
          total: 100,
          message: `Starting update_file request...`
        });
      }
      
      // Use authenticated request for OAuth (both ConstructionWire and standard OAuth)
      const response = await this.makeAuthenticatedRequest({ method: 'PATCH', url: path, params: queryParams, data: hasRawArrayBody ? rawBodyData : (Object.keys(bodyParams).length > 0 ? bodyParams : undefined) }, options);
      
      // Report completion progress if callback provided
      if (options?.onProgress) {
        await options.onProgress({
          progress: 100,
          total: 100,
          message: `Completed update_file request`
        });
      }
      
      const duration = Date.now() - startTime;
      this.logger.info('ENDPOINT_SUCCESS', 'Endpoint execution completed successfully', {
        endpoint: 'update_file',
        method: 'PATCH',
        path: '/drive/v3/files/{fileId}',
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
          endpoint: 'update_file',
          method: 'PATCH',
          path: '/drive/v3/files/{fileId}',
          duration_ms: duration
        });
        throw new Error('Request was cancelled');
      }
      
      this.logger.error('ENDPOINT_ERROR', 'Endpoint execution failed', {
        endpoint: 'update_file',
        method: 'PATCH',
        path: '/drive/v3/files/{fileId}',
        duration_ms: duration,
        error: error instanceof Error ? error.message : String(error),
        errorType: error instanceof Error ? error.constructor.name : 'unknown'
      });
      throw new Error(`Failed to execute update_file: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /* DEBUG: endpoint={"name":"delete_file","method":"DELETE","path":"/drive/v3/files/{fileId}","description":"Permanently delete a file. Returns 204 No Content with empty body on success.","parameters":{"fileId":{"type":"string","required":true,"description":"ID of the file to delete","location":"path"},"supportsAllDrives":{"type":"boolean","required":false,"description":"Whether to support files in shared drives","location":"query"}},"response_format":"empty","success_status":204,"category":"File Management"} */
  async deleteFile(params: any, options?: RequestOptions): Promise<any> {
    const startTime = Date.now();
    this.logger.info('ENDPOINT_START', 'Endpoint execution started', {
      endpoint: 'delete_file',
      method: 'DELETE',
      path: '/drive/v3/files/{fileId}',
      paramCount: Object.keys(params || {}).length,
      paramKeys: Object.keys(params || {})
    });
    
    try {
      
      // Extract and separate parameters by location: path, query, body
      const pathTemplate = '/drive/v3/files/{fileId}';
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
      
      // Any remaining unprocessed parameters default to body for backward compatibility
      for (const [key, value] of Object.entries(params)) {
        if (!extractedParams.includes(key)) {
          bodyParams[key] = value;
        }
      }
      
      // Validate required parameters
      
      const path = this.buildPath('/drive/v3/files/{fileId}', pathParams);
      // For GraphQL endpoints that use '/' as the path, use empty string to avoid double slash
      const requestPath = path === '/' ? '' : path;
      
      // Report initial progress if callback provided
      if (options?.onProgress) {
        await options.onProgress({
          progress: 0,
          total: 100,
          message: `Starting delete_file request...`
        });
      }
      
      // Use authenticated request for OAuth (both ConstructionWire and standard OAuth)
      const response = await this.makeAuthenticatedRequest({ method: 'DELETE', url: path, params: queryParams }, options);
      
      // Report completion progress if callback provided
      if (options?.onProgress) {
        await options.onProgress({
          progress: 100,
          total: 100,
          message: `Completed delete_file request`
        });
      }
      
      const duration = Date.now() - startTime;
      this.logger.info('ENDPOINT_SUCCESS', 'Endpoint execution completed successfully', {
        endpoint: 'delete_file',
        method: 'DELETE',
        path: '/drive/v3/files/{fileId}',
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
          endpoint: 'delete_file',
          method: 'DELETE',
          path: '/drive/v3/files/{fileId}',
          duration_ms: duration
        });
        throw new Error('Request was cancelled');
      }
      
      this.logger.error('ENDPOINT_ERROR', 'Endpoint execution failed', {
        endpoint: 'delete_file',
        method: 'DELETE',
        path: '/drive/v3/files/{fileId}',
        duration_ms: duration,
        error: error instanceof Error ? error.message : String(error),
        errorType: error instanceof Error ? error.constructor.name : 'unknown'
      });
      throw new Error(`Failed to execute delete_file: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /* DEBUG: endpoint={"name":"search_files","method":"GET","path":"/drive/v3/files","description":"Advanced file search with complex query syntax","parameters":{"q":{"type":"string","required":true,"description":"Advanced search query (e.g., 'fullText contains \"keyword\" and mimeType contains \"google-apps\"')","location":"query"},"pageSize":{"type":"number","required":false,"description":"Maximum number of results to return","location":"query"},"pageToken":{"type":"string","required":false,"description":"Page token for pagination","location":"query"},"fields":{"type":"string","required":false,"description":"Fields to return - IMPORTANT: Must use format 'files(id,name,mimeType,size,parents,webViewLink)' for list endpoints. Do NOT use 'id,name,mimeType' format.","location":"query"},"orderBy":{"type":"string","required":false,"description":"Sort order for search results","location":"query"},"includeItemsFromAllDrives":{"type":"boolean","required":false,"description":"Whether to include files from all drives","location":"query"},"supportsAllDrives":{"type":"boolean","required":false,"description":"Whether to support shared drives","location":"query"}},"response_format":"json","category":"Search & Organization"} */
  async searchFiles(params: any, options?: RequestOptions): Promise<any> {
    const startTime = Date.now();
    this.logger.info('ENDPOINT_START', 'Endpoint execution started', {
      endpoint: 'search_files',
      method: 'GET',
      path: '/drive/v3/files',
      paramCount: Object.keys(params || {}).length,
      paramKeys: Object.keys(params || {})
    });
    
    try {
      
      // Extract and separate parameters by location: path, query, body
      const pathTemplate = '/drive/v3/files';
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
      
      const path = this.buildPath('/drive/v3/files', pathParams);
      // For GraphQL endpoints that use '/' as the path, use empty string to avoid double slash
      const requestPath = path === '/' ? '' : path;
      
      // Report initial progress if callback provided
      if (options?.onProgress) {
        await options.onProgress({
          progress: 0,
          total: 100,
          message: `Starting search_files request...`
        });
      }
      
      // Use authenticated request for OAuth (both ConstructionWire and standard OAuth)
      const response = await this.makeAuthenticatedRequest({ method: 'GET', url: path, params: queryParams }, options);
      
      // Report completion progress if callback provided
      if (options?.onProgress) {
        await options.onProgress({
          progress: 100,
          total: 100,
          message: `Completed search_files request`
        });
      }
      
      const duration = Date.now() - startTime;
      this.logger.info('ENDPOINT_SUCCESS', 'Endpoint execution completed successfully', {
        endpoint: 'search_files',
        method: 'GET',
        path: '/drive/v3/files',
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
          endpoint: 'search_files',
          method: 'GET',
          path: '/drive/v3/files',
          duration_ms: duration
        });
        throw new Error('Request was cancelled');
      }
      
      this.logger.error('ENDPOINT_ERROR', 'Endpoint execution failed', {
        endpoint: 'search_files',
        method: 'GET',
        path: '/drive/v3/files',
        duration_ms: duration,
        error: error instanceof Error ? error.message : String(error),
        errorType: error instanceof Error ? error.constructor.name : 'unknown'
      });
      throw new Error(`Failed to execute search_files: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /* DEBUG: endpoint={"name":"create_file","description":"create_file endpoint for google-drive","inputSchema":{"type":"object","properties":{},"required":[]}} */
  async createFile(params: any, options?: RequestOptions): Promise<any> {
    const startTime = Date.now();
    this.logger.info('ENDPOINT_START', 'Endpoint execution started', {
      endpoint: 'create_file',
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
          message: `Starting create_file request...`
        });
      }
      
      // Use authenticated request for OAuth (both ConstructionWire and standard OAuth)
      const response = await this.makeAuthenticatedRequest({ method: 'GET', url: path, params: queryParams }, options);
            
      // Report completion progress if callback provided
      if (options?.onProgress) {
        await options.onProgress({
          progress: 100,
          total: 100,
          message: `Completed create_file request`
        });
      }
      
      const duration = Date.now() - startTime;
      this.logger.info('ENDPOINT_SUCCESS', 'Endpoint execution completed successfully', {
        endpoint: 'create_file',
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
          endpoint: 'create_file',
          method: '',
          path: '',
          duration_ms: duration
        });
        throw new Error('Request was cancelled');
      }
      
      this.logger.error('ENDPOINT_ERROR', 'Endpoint execution failed', {
        endpoint: 'create_file',
        method: '',
        path: '',
        duration_ms: duration,
        error: error instanceof Error ? error.message : String(error),
        errorType: error instanceof Error ? error.constructor.name : 'unknown'
      });
      throw new Error(`Failed to execute create_file: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /* DEBUG: endpoint={"name":"share_file","description":"share_file endpoint for google-drive","inputSchema":{"type":"object","properties":{},"required":[]}} */
  async shareFile(params: any, options?: RequestOptions): Promise<any> {
    const startTime = Date.now();
    this.logger.info('ENDPOINT_START', 'Endpoint execution started', {
      endpoint: 'share_file',
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
          message: `Starting share_file request...`
        });
      }
      
      // Use authenticated request for OAuth (both ConstructionWire and standard OAuth)
      const response = await this.makeAuthenticatedRequest({ method: 'GET', url: path, params: queryParams }, options);
            
      // Report completion progress if callback provided
      if (options?.onProgress) {
        await options.onProgress({
          progress: 100,
          total: 100,
          message: `Completed share_file request`
        });
      }
      
      const duration = Date.now() - startTime;
      this.logger.info('ENDPOINT_SUCCESS', 'Endpoint execution completed successfully', {
        endpoint: 'share_file',
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
          endpoint: 'share_file',
          method: '',
          path: '',
          duration_ms: duration
        });
        throw new Error('Request was cancelled');
      }
      
      this.logger.error('ENDPOINT_ERROR', 'Endpoint execution failed', {
        endpoint: 'share_file',
        method: '',
        path: '',
        duration_ms: duration,
        error: error instanceof Error ? error.message : String(error),
        errorType: error instanceof Error ? error.constructor.name : 'unknown'
      });
      throw new Error(`Failed to execute share_file: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

}