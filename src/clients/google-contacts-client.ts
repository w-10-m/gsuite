import axios, { AxiosInstance } from 'axios';
import { Logger } from '../services/logger.js';
import { RequestOptions, ProgressCallback } from '../types.js';

export interface GoogleContactsClientConfig {
  gOOGLEOAUTHCREDENTIALS?: string;
  scopes?: any;
  timeout?: number;
  rateLimit?: number; // requests per minute
  authToken?: string;
  logger?: Logger;
  oauthClient?: any; // OAuth client for token management
}

export class GoogleContactsClient {
  private httpClient: AxiosInstance;
  private config: GoogleContactsClientConfig;
  private sessionId: string;
  private logger: Logger;
  private oauthClient: any; // OAuth client for token management
  
  constructor(config: GoogleContactsClientConfig) {
    this.config = config;
    
    // Generate unique session ID for this client instance
    this.sessionId = `google-contacts-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    
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
    // console.error('[GoogleContactsClient] Resolving base URL...');
    // console.error('[GoogleContactsClient] Template base_url:', 'https://people.googleapis.com');
    // console.error('[GoogleContactsClient] CustomConfig baseUrl:', '');
    
    let baseUrl = 'https://people.googleapis.com';
    
    // console.error('[GoogleContactsClient] Initial resolved baseUrl:', baseUrl);
    
    // If no base URL was found, throw an error
    if (!baseUrl) {
      throw new Error(`No base URL configured for google-contacts. Please provide base_url in template or customConfig.baseUrl.`);
    }
    
    // Handle dynamic domain replacement for patterns like CONFLUENCE_DOMAIN, JIRA_DOMAIN, etc.
    const domainEnvVar = `GOOGLE-CONTACTS_DOMAIN`;
    const domain = process.env[domainEnvVar];
    // console.error(`[GoogleContactsClient] Domain env var (${domainEnvVar}):`, domain);
    
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
        template: 'google-contacts',
        baseUrl: baseUrl
      });
    }
    
    // console.error('[GoogleContactsClient] Final resolved baseUrl:', baseUrl);
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

  /* DEBUG: endpoint={"name":"create_contact","method":"POST","path":"/v1/people:createContact","description":"Create a new contact with specified fields","parameters":{"personFields":{"type":"string","required":true,"description":"Comma-separated list of fields to return (e.g., 'names,emailAddresses,phoneNumbers,addresses,organizations')","location":"query"},"sources":{"type":"string","required":false,"description":"Sources to create the contact in (default: 'CONTACT')","location":"query"},"names":{"type":"object","required":false,"description":"Array of name objects with givenName, familyName, displayName, etc.","location":"body"},"emailAddresses":{"type":"object","required":false,"description":"Array of email address objects with value, type, etc.","location":"body"},"phoneNumbers":{"type":"object","required":false,"description":"Array of phone number objects with value, type, etc.","location":"body"},"addresses":{"type":"object","required":false,"description":"Array of address objects with formattedValue, type, etc.","location":"body"},"organizations":{"type":"object","required":false,"description":"Array of organization objects with name, title, etc.","location":"body"},"biographies":{"type":"object","required":false,"description":"Array of biography objects with value, contentType, etc.","location":"body"},"birthdays":{"type":"object","required":false,"description":"Array of birthday objects with date information","location":"body"},"urls":{"type":"object","required":false,"description":"Array of URL objects with value, type, etc.","location":"body"}},"response_format":"json","category":"Data Management"} */
  async createContact(params: any, options?: RequestOptions): Promise<any> {
    const startTime = Date.now();
    this.logger.info('ENDPOINT_START', 'Endpoint execution started', {
      endpoint: 'create_contact',
      method: 'POST',
      path: '/v1/people:createContact',
      paramCount: Object.keys(params || {}).length,
      paramKeys: Object.keys(params || {})
    });
    
    try {
      
      // Extract and separate parameters by location: path, query, body
      const pathTemplate = '/v1/people:createContact';
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
      
      const path = this.buildPath('/v1/people:createContact', pathParams);
      // For GraphQL endpoints that use '/' as the path, use empty string to avoid double slash
      const requestPath = path === '/' ? '' : path;
      
      // Report initial progress if callback provided
      if (options?.onProgress) {
        await options.onProgress({
          progress: 0,
          total: 100,
          message: `Starting create_contact request...`
        });
      }
      
      // Use authenticated request for OAuth (both ConstructionWire and standard OAuth)
      const response = await this.makeAuthenticatedRequest({ method: 'POST', url: path, params: queryParams, data: hasRawArrayBody ? rawBodyData : (Object.keys(bodyParams).length > 0 ? bodyParams : undefined) }, options);
      
      // Report completion progress if callback provided
      if (options?.onProgress) {
        await options.onProgress({
          progress: 100,
          total: 100,
          message: `Completed create_contact request`
        });
      }
      
      const duration = Date.now() - startTime;
      this.logger.info('ENDPOINT_SUCCESS', 'Endpoint execution completed successfully', {
        endpoint: 'create_contact',
        method: 'POST',
        path: '/v1/people:createContact',
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
          endpoint: 'create_contact',
          method: 'POST',
          path: '/v1/people:createContact',
          duration_ms: duration
        });
        throw new Error('Request was cancelled');
      }
      
      this.logger.error('ENDPOINT_ERROR', 'Endpoint execution failed', {
        endpoint: 'create_contact',
        method: 'POST',
        path: '/v1/people:createContact',
        duration_ms: duration,
        error: error instanceof Error ? error.message : String(error),
        errorType: error instanceof Error ? error.constructor.name : 'unknown'
      });
      throw new Error(`Failed to execute create_contact: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /* DEBUG: endpoint={"name":"update_contact","method":"PATCH","path":"/v1/{person.resourceName=people/*}:updateContact","description":"Update an existing contact. IMPORTANT: Include the 'etag' field in the request body to prevent conflicts. Get the current etag by first calling get_contact or from a previous create/update response.","parameters":{"person.resourceName":{"type":"string","required":true,"description":"Resource name of the contact (e.g., 'people/c1234567890')","location":"path"},"updatePersonFields":{"type":"string","required":true,"description":"Comma-separated list of fields to update (e.g., 'names,emailAddresses,phoneNumbers')","location":"query"},"personFields":{"type":"string","required":false,"description":"Comma-separated list of fields to return in response","location":"query"},"sources":{"type":"string","required":false,"description":"Sources to update the contact in","location":"query"},"names":{"type":"object","required":false,"description":"Array of name objects to update","location":"body"},"emailAddresses":{"type":"object","required":false,"description":"Array of email address objects to update","location":"body"},"phoneNumbers":{"type":"object","required":false,"description":"Array of phone number objects to update","location":"body"},"addresses":{"type":"object","required":false,"description":"Array of address objects to update","location":"body"},"organizations":{"type":"object","required":false,"description":"Array of organization objects to update","location":"body"},"biographies":{"type":"object","required":false,"description":"Array of biography objects to update","location":"body"},"birthdays":{"type":"object","required":false,"description":"Array of birthday objects to update","location":"body"},"urls":{"type":"object","required":false,"description":"Array of URL objects to update","location":"body"},"etag":{"type":"string","required":true,"description":"ETag from the contact's current state (obtained from get_contact, create_contact, or previous update_contact response). Required for concurrency control and conflict prevention.","location":"body"}},"response_format":"json","category":"Data Management"} */
  async updateContact(params: any, options?: RequestOptions): Promise<any> {
    const startTime = Date.now();
    this.logger.info('ENDPOINT_START', 'Endpoint execution started', {
      endpoint: 'update_contact',
      method: 'PATCH',
      path: '/v1/{person.resourceName=people/*}:updateContact',
      paramCount: Object.keys(params || {}).length,
      paramKeys: Object.keys(params || {})
    });
    
    try {
      
      // Extract and separate parameters by location: path, query, body
      const pathTemplate = '/v1/{person.resourceName=people/*}:updateContact';
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
      
      const path = this.buildPath('/v1/{person.resourceName=people/*}:updateContact', pathParams);
      // For GraphQL endpoints that use '/' as the path, use empty string to avoid double slash
      const requestPath = path === '/' ? '' : path;
      
      // Report initial progress if callback provided
      if (options?.onProgress) {
        await options.onProgress({
          progress: 0,
          total: 100,
          message: `Starting update_contact request...`
        });
      }
      
      // Use authenticated request for OAuth (both ConstructionWire and standard OAuth)
      const response = await this.makeAuthenticatedRequest({ method: 'PATCH', url: path, params: queryParams, data: hasRawArrayBody ? rawBodyData : (Object.keys(bodyParams).length > 0 ? bodyParams : undefined) }, options);
      
      // Report completion progress if callback provided
      if (options?.onProgress) {
        await options.onProgress({
          progress: 100,
          total: 100,
          message: `Completed update_contact request`
        });
      }
      
      const duration = Date.now() - startTime;
      this.logger.info('ENDPOINT_SUCCESS', 'Endpoint execution completed successfully', {
        endpoint: 'update_contact',
        method: 'PATCH',
        path: '/v1/{person.resourceName=people/*}:updateContact',
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
          endpoint: 'update_contact',
          method: 'PATCH',
          path: '/v1/{person.resourceName&#x3D;people/*}:updateContact',
          duration_ms: duration
        });
        throw new Error('Request was cancelled');
      }
      
      this.logger.error('ENDPOINT_ERROR', 'Endpoint execution failed', {
        endpoint: 'update_contact',
        method: 'PATCH',
        path: '/v1/{person.resourceName=people/*}:updateContact',
        duration_ms: duration,
        error: error instanceof Error ? error.message : String(error),
        errorType: error instanceof Error ? error.constructor.name : 'unknown'
      });
      throw new Error(`Failed to execute update_contact: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /* DEBUG: endpoint={"name":"delete_contact","method":"DELETE","path":"/v1/{resourceName=people/*}:deleteContact","description":"Delete a contact permanently","parameters":{"resourceName":{"type":"string","required":true,"description":"Resource name of the contact to delete (e.g., 'people/c1234567890')","location":"path"}},"response_format":"json","category":"Data Deletion"} */
  async deleteContact(params: any, options?: RequestOptions): Promise<any> {
    const startTime = Date.now();
    this.logger.info('ENDPOINT_START', 'Endpoint execution started', {
      endpoint: 'delete_contact',
      method: 'DELETE',
      path: '/v1/{resourceName=people/*}:deleteContact',
      paramCount: Object.keys(params || {}).length,
      paramKeys: Object.keys(params || {})
    });
    
    try {
      
      // Extract and separate parameters by location: path, query, body
      const pathTemplate = '/v1/{resourceName=people/*}:deleteContact';
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
      
      const path = this.buildPath('/v1/{resourceName=people/*}:deleteContact', pathParams);
      // For GraphQL endpoints that use '/' as the path, use empty string to avoid double slash
      const requestPath = path === '/' ? '' : path;
      
      // Report initial progress if callback provided
      if (options?.onProgress) {
        await options.onProgress({
          progress: 0,
          total: 100,
          message: `Starting delete_contact request...`
        });
      }
      
      // Use authenticated request for OAuth (both ConstructionWire and standard OAuth)
      const response = await this.makeAuthenticatedRequest({ method: 'DELETE', url: path, params: queryParams }, options);
      
      // Report completion progress if callback provided
      if (options?.onProgress) {
        await options.onProgress({
          progress: 100,
          total: 100,
          message: `Completed delete_contact request`
        });
      }
      
      const duration = Date.now() - startTime;
      this.logger.info('ENDPOINT_SUCCESS', 'Endpoint execution completed successfully', {
        endpoint: 'delete_contact',
        method: 'DELETE',
        path: '/v1/{resourceName=people/*}:deleteContact',
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
          endpoint: 'delete_contact',
          method: 'DELETE',
          path: '/v1/{resourceName&#x3D;people/*}:deleteContact',
          duration_ms: duration
        });
        throw new Error('Request was cancelled');
      }
      
      this.logger.error('ENDPOINT_ERROR', 'Endpoint execution failed', {
        endpoint: 'delete_contact',
        method: 'DELETE',
        path: '/v1/{resourceName=people/*}:deleteContact',
        duration_ms: duration,
        error: error instanceof Error ? error.message : String(error),
        errorType: error instanceof Error ? error.constructor.name : 'unknown'
      });
      throw new Error(`Failed to execute delete_contact: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /* DEBUG: endpoint={"name":"search_contacts","method":"GET","path":"/v1/people:searchContacts","description":"Search across all contacts with text query","parameters":{"query":{"type":"string","required":true,"description":"Text search query to match against contact fields","location":"query"},"pageSize":{"type":"number","required":false,"description":"Number of results to return (max 30, default 10)","location":"query"},"readMask":{"type":"string","required":false,"description":"Comma-separated list of fields to return (e.g., 'names,emailAddresses,phoneNumbers')","location":"query"},"sources":{"type":"string","required":false,"description":"Comma-separated list of sources to search (READ_SOURCE_TYPE_CONTACT, READ_SOURCE_TYPE_DOMAIN_CONTACT)","location":"query"}},"response_format":"json","category":"Search & Query"} */
  async searchContacts(params: any, options?: RequestOptions): Promise<any> {
    const startTime = Date.now();
    this.logger.info('ENDPOINT_START', 'Endpoint execution started', {
      endpoint: 'search_contacts',
      method: 'GET',
      path: '/v1/people:searchContacts',
      paramCount: Object.keys(params || {}).length,
      paramKeys: Object.keys(params || {})
    });
    
    try {
      
      // Extract and separate parameters by location: path, query, body
      const pathTemplate = '/v1/people:searchContacts';
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
      
      // Any remaining unprocessed parameters default to body for backward compatibility
      for (const [key, value] of Object.entries(params)) {
        if (!extractedParams.includes(key)) {
          bodyParams[key] = value;
        }
      }
      
      // Validate required parameters
      
      const path = this.buildPath('/v1/people:searchContacts', pathParams);
      // For GraphQL endpoints that use '/' as the path, use empty string to avoid double slash
      const requestPath = path === '/' ? '' : path;
      
      // Report initial progress if callback provided
      if (options?.onProgress) {
        await options.onProgress({
          progress: 0,
          total: 100,
          message: `Starting search_contacts request...`
        });
      }
      
      // Use authenticated request for OAuth (both ConstructionWire and standard OAuth)
      const response = await this.makeAuthenticatedRequest({ method: 'GET', url: path, params: queryParams }, options);
      
      // Report completion progress if callback provided
      if (options?.onProgress) {
        await options.onProgress({
          progress: 100,
          total: 100,
          message: `Completed search_contacts request`
        });
      }
      
      const duration = Date.now() - startTime;
      this.logger.info('ENDPOINT_SUCCESS', 'Endpoint execution completed successfully', {
        endpoint: 'search_contacts',
        method: 'GET',
        path: '/v1/people:searchContacts',
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
          endpoint: 'search_contacts',
          method: 'GET',
          path: '/v1/people:searchContacts',
          duration_ms: duration
        });
        throw new Error('Request was cancelled');
      }
      
      this.logger.error('ENDPOINT_ERROR', 'Endpoint execution failed', {
        endpoint: 'search_contacts',
        method: 'GET',
        path: '/v1/people:searchContacts',
        duration_ms: duration,
        error: error instanceof Error ? error.message : String(error),
        errorType: error instanceof Error ? error.constructor.name : 'unknown'
      });
      throw new Error(`Failed to execute search_contacts: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /* DEBUG: endpoint={"name":"list_contacts","description":"list_contacts endpoint for google-contacts","inputSchema":{"type":"object","properties":{},"required":[]}} */
  async listContacts(params: any, options?: RequestOptions): Promise<any> {
    const startTime = Date.now();
    this.logger.info('ENDPOINT_START', 'Endpoint execution started', {
      endpoint: 'list_contacts',
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
          message: `Starting list_contacts request...`
        });
      }
      
      // Use authenticated request for OAuth (both ConstructionWire and standard OAuth)
      const response = await this.makeAuthenticatedRequest({ method: 'GET', url: path, params: queryParams }, options);
            
      // Report completion progress if callback provided
      if (options?.onProgress) {
        await options.onProgress({
          progress: 100,
          total: 100,
          message: `Completed list_contacts request`
        });
      }
      
      const duration = Date.now() - startTime;
      this.logger.info('ENDPOINT_SUCCESS', 'Endpoint execution completed successfully', {
        endpoint: 'list_contacts',
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
          endpoint: 'list_contacts',
          method: '',
          path: '',
          duration_ms: duration
        });
        throw new Error('Request was cancelled');
      }
      
      this.logger.error('ENDPOINT_ERROR', 'Endpoint execution failed', {
        endpoint: 'list_contacts',
        method: '',
        path: '',
        duration_ms: duration,
        error: error instanceof Error ? error.message : String(error),
        errorType: error instanceof Error ? error.constructor.name : 'unknown'
      });
      throw new Error(`Failed to execute list_contacts: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /* DEBUG: endpoint={"name":"get_contact","description":"get_contact endpoint for google-contacts","inputSchema":{"type":"object","properties":{},"required":[]}} */
  async getContact(params: any, options?: RequestOptions): Promise<any> {
    const startTime = Date.now();
    this.logger.info('ENDPOINT_START', 'Endpoint execution started', {
      endpoint: 'get_contact',
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
          message: `Starting get_contact request...`
        });
      }
      
      // Use authenticated request for OAuth (both ConstructionWire and standard OAuth)
      const response = await this.makeAuthenticatedRequest({ method: 'GET', url: path, params: queryParams }, options);
            
      // Report completion progress if callback provided
      if (options?.onProgress) {
        await options.onProgress({
          progress: 100,
          total: 100,
          message: `Completed get_contact request`
        });
      }
      
      const duration = Date.now() - startTime;
      this.logger.info('ENDPOINT_SUCCESS', 'Endpoint execution completed successfully', {
        endpoint: 'get_contact',
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
          endpoint: 'get_contact',
          method: '',
          path: '',
          duration_ms: duration
        });
        throw new Error('Request was cancelled');
      }
      
      this.logger.error('ENDPOINT_ERROR', 'Endpoint execution failed', {
        endpoint: 'get_contact',
        method: '',
        path: '',
        duration_ms: duration,
        error: error instanceof Error ? error.message : String(error),
        errorType: error instanceof Error ? error.constructor.name : 'unknown'
      });
      throw new Error(`Failed to execute get_contact: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

}