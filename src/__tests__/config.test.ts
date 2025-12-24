import { loadConfig, validateConfig, ServerConfig } from '../config.js';

describe('Config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('loadConfig', () => {
    it('should load default configuration', () => {
      process.env.GOOGLE_OAUTH_CREDENTIALS = 'test-credentials';
      const config = loadConfig();

      expect(config.logShipping.enabled).toBe(false);
      expect(config.logShipping.batchSize).toBe(500);
      expect(config.logShipping.flushInterval).toBe(5000);
      expect(config.logShipping.maxRetries).toBe(3);
      expect(config.logShipping.logLevel).toBe('ERROR');
    });

    it('should load log shipping configuration from environment', () => {
      process.env.LOG_SHIPPING_ENABLED = 'true';
      process.env.LOG_INGESTION_URL = 'https://logs.example.com';
      process.env.LOG_INGESTION_API_KEY = 'api-key';
      process.env.LOG_SHIPPING_BATCH_SIZE = '100';
      process.env.LOG_SHIPPING_INTERVAL = '10000';
      process.env.LOG_SHIPPING_MAX_RETRIES = '5';
      process.env.LOG_LEVEL = 'DEBUG';
      process.env.GOOGLE_OAUTH_CREDENTIALS = 'test-credentials';

      const config = loadConfig();

      expect(config.logShipping.enabled).toBe(true);
      expect(config.logShipping.endpoint).toBe('https://logs.example.com');
      expect(config.logShipping.apiKey).toBe('api-key');
      expect(config.logShipping.batchSize).toBe(100);
      expect(config.logShipping.flushInterval).toBe(10000);
      expect(config.logShipping.maxRetries).toBe(5);
      expect(config.logShipping.logLevel).toBe('DEBUG');
    });

    it('should load google services configuration', () => {
      process.env.GOOGLE_OAUTH_CREDENTIALS = 'google_oauth_credentials';

      const config = loadConfig();

      expect(config.googleGmail.gOOGLEOAUTHCREDENTIALS).toBe('google_oauth_credentials');
      expect(config.googleDrive.gOOGLEOAUTHCREDENTIALS).toBe('google_oauth_credentials');
      expect(config.googleCalendar.gOOGLEOAUTHCREDENTIALS).toBe('google_oauth_credentials');
      expect(config.googleContacts.gOOGLEOAUTHCREDENTIALS).toBe('google_oauth_credentials');
    });

    it('should have correct scopes for each google service', () => {
      process.env.GOOGLE_OAUTH_CREDENTIALS = 'test-credentials';

      const config = loadConfig();

      expect(config.googleGmail.scopes).toContain('https://www.googleapis.com/auth/gmail.readonly');
      expect(config.googleDrive.scopes).toContain('https://www.googleapis.com/auth/drive');
      expect(config.googleCalendar.scopes).toContain('https://www.googleapis.com/auth/calendar');
      expect(config.googleContacts.scopes).toContain('https://www.googleapis.com/auth/contacts');
    });
  });

  describe('validateConfig', () => {
    it('should validate a valid configuration', () => {
      process.env.GOOGLE_OAUTH_CREDENTIALS = 'test-credentials';

      const config: ServerConfig = {
        logShipping: {
          enabled: false,
          endpoint: '',
          batchSize: 500,
          flushInterval: 5000,
          maxRetries: 3,
          logLevel: 'ERROR'
        },
        googleGmail: {
          gOOGLEOAUTHCREDENTIALS: 'test-credentials',
          scopes: []
        },
        googleDrive: {
          gOOGLEOAUTHCREDENTIALS: 'test-credentials',
          scopes: []
        },
        googleCalendar: {
          gOOGLEOAUTHCREDENTIALS: 'test-credentials',
          scopes: []
        },
        googleContacts: {
          gOOGLEOAUTHCREDENTIALS: 'test-credentials',
          scopes: []
        }
      };

      const result = validateConfig(config);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should require GOOGLE_OAUTH_CREDENTIALS', () => {
      delete process.env.GOOGLE_OAUTH_CREDENTIALS;

      const config: ServerConfig = {
        logShipping: {
          enabled: false,
          endpoint: '',
          batchSize: 500,
          flushInterval: 5000,
          maxRetries: 3,
          logLevel: 'ERROR'
        },
        googleGmail: {
          gOOGLEOAUTHCREDENTIALS: '',
          scopes: []
        },
        googleDrive: {
          gOOGLEOAUTHCREDENTIALS: '',
          scopes: []
        },
        googleCalendar: {
          gOOGLEOAUTHCREDENTIALS: '',
          scopes: []
        },
        googleContacts: {
          gOOGLEOAUTHCREDENTIALS: '',
          scopes: []
        }
      };

      const result = validateConfig(config);

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes('GOOGLE_OAUTH_CREDENTIALS'))).toBe(true);
    });

    describe('log shipping validation', () => {
      beforeEach(() => {
        process.env.GOOGLE_OAUTH_CREDENTIALS = 'test-credentials';
      });

      it('should require endpoint when log shipping is enabled', () => {
        const config: ServerConfig = {
          logShipping: {
            enabled: true,
            endpoint: '',
            batchSize: 500,
            flushInterval: 5000,
            maxRetries: 3,
            logLevel: 'ERROR'
          },
          googleGmail: { gOOGLEOAUTHCREDENTIALS: 'test', scopes: [] },
          googleDrive: { gOOGLEOAUTHCREDENTIALS: 'test', scopes: [] },
          googleCalendar: { gOOGLEOAUTHCREDENTIALS: 'test', scopes: [] },
          googleContacts: { gOOGLEOAUTHCREDENTIALS: 'test', scopes: [] }
        };

        const result = validateConfig(config);

        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('LOG_INGESTION_URL environment variable is required when log shipping is enabled');
      });

      it('should require HTTPS for endpoint', () => {
        const config: ServerConfig = {
          logShipping: {
            enabled: true,
            endpoint: 'http://logs.example.com',
            batchSize: 500,
            flushInterval: 5000,
            maxRetries: 3,
            logLevel: 'ERROR'
          },
          googleGmail: { gOOGLEOAUTHCREDENTIALS: 'test', scopes: [] },
          googleDrive: { gOOGLEOAUTHCREDENTIALS: 'test', scopes: [] },
          googleCalendar: { gOOGLEOAUTHCREDENTIALS: 'test', scopes: [] },
          googleContacts: { gOOGLEOAUTHCREDENTIALS: 'test', scopes: [] }
        };

        const result = validateConfig(config);

        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('LOG_INGESTION_URL must use HTTPS protocol');
      });

      it('should validate batch size range', () => {
        const config: ServerConfig = {
          logShipping: {
            enabled: true,
            endpoint: 'https://logs.example.com',
            batchSize: 1500,
            flushInterval: 5000,
            maxRetries: 3,
            logLevel: 'ERROR'
          },
          googleGmail: { gOOGLEOAUTHCREDENTIALS: 'test', scopes: [] },
          googleDrive: { gOOGLEOAUTHCREDENTIALS: 'test', scopes: [] },
          googleCalendar: { gOOGLEOAUTHCREDENTIALS: 'test', scopes: [] },
          googleContacts: { gOOGLEOAUTHCREDENTIALS: 'test', scopes: [] }
        };

        const result = validateConfig(config);

        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('LOG_SHIPPING_BATCH_SIZE must be between 1 and 1000');
      });

      it('should validate minimum flush interval', () => {
        const config: ServerConfig = {
          logShipping: {
            enabled: true,
            endpoint: 'https://logs.example.com',
            batchSize: 500,
            flushInterval: 500,
            maxRetries: 3,
            logLevel: 'ERROR'
          },
          googleGmail: { gOOGLEOAUTHCREDENTIALS: 'test', scopes: [] },
          googleDrive: { gOOGLEOAUTHCREDENTIALS: 'test', scopes: [] },
          googleCalendar: { gOOGLEOAUTHCREDENTIALS: 'test', scopes: [] },
          googleContacts: { gOOGLEOAUTHCREDENTIALS: 'test', scopes: [] }
        };

        const result = validateConfig(config);

        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('LOG_SHIPPING_INTERVAL must be at least 1000ms');
      });

      it('should require API key when requireApiKey is true', () => {
        const config: ServerConfig = {
          logShipping: {
            enabled: true,
            endpoint: 'https://logs.example.com',
            requireApiKey: true,
            batchSize: 500,
            flushInterval: 5000,
            maxRetries: 3,
            logLevel: 'ERROR'
          },
          googleGmail: { gOOGLEOAUTHCREDENTIALS: 'test', scopes: [] },
          googleDrive: { gOOGLEOAUTHCREDENTIALS: 'test', scopes: [] },
          googleCalendar: { gOOGLEOAUTHCREDENTIALS: 'test', scopes: [] },
          googleContacts: { gOOGLEOAUTHCREDENTIALS: 'test', scopes: [] }
        };

        const result = validateConfig(config);

        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('LOG_INGESTION_API_KEY environment variable is required when LOG_SHIPPING_REQUIRE_API_KEY is true');
      });
    });
  });
});
