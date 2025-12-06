import { OAuth2Client } from 'google-auth-library';
import { TokenManager } from './token-manager.js';
import open from 'open';
import http from 'http';
import url from 'url';

export interface OAuth2Tokens {
  access_token?: string | null;
  refresh_token?: string | null;
  expiry_date?: number | null;
  scope?: string | null;
  token_type?: string | null;
}

export class GoogleOAuthClient {
  private oauth2Client!: OAuth2Client; // Definite assignment assertion
  private tokenManager: TokenManager;
  private redirectUri: string;
  private scopes: string[] = [
    'https://www.googleapis.com/auth/contacts.readonly',
    'https://www.googleapis.com/auth/calendar.readonly'
  ];

  constructor() {
    this.tokenManager = new TokenManager();
    // Set redirect URI with default fallback
    this.redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000';
  }

  /**
   * Initialize OAuth client
   */
  async initialize(): Promise<void> {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

    if (!clientId) {
      throw new Error('GOOGLE_CLIENT_ID environment variable is required');
    }

    if (!clientSecret) {
      throw new Error('GOOGLE_CLIENT_SECRET environment variable is required');
    }

    this.oauth2Client = new OAuth2Client(
      clientId,
      clientSecret,
      this.redirectUri
    );

    console.error('[GOOGLE_OAUTH] OAuth client initialized');
    console.error(`[GOOGLE_OAUTH] Redirect URI: ${this.redirectUri}`);
  }

  /**
   * Ensure we have a valid access token
   */
  async getValidAccessToken(): Promise<string> {
    const tokens = await this.tokenManager.getTokens();
    
    if (!tokens) {
      console.error('[GOOGLE_OAUTH] No OAuth tokens found. Starting authorization flow...');
      await this.authorize();
      return this.getValidAccessToken();
    }

    if (this.isTokenExpired(tokens)) {
      console.error('[GOOGLE_OAUTH] Token expired, refreshing...');
      if (!tokens.refresh_token) {
        throw new Error('No refresh token available for token refresh');
      }
      const refreshedTokens = await this.refreshTokens(tokens.refresh_token);
      if (!refreshedTokens.access_token) {
        throw new Error('Failed to refresh access token');
      }
      return refreshedTokens.access_token;
    }

    if (!tokens.access_token) {
      throw new Error('No access token available');
    }
    return tokens.access_token;
  }

  /**
   * Start OAuth authorization flow
   */
  private async authorize(): Promise<void> {
    const authUrl = this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: this.scopes,
      prompt: 'consent'
    });

    console.error('[GOOGLE_OAUTH] Starting OAuth authorization flow...');
    console.error('[GOOGLE_OAUTH] Opening browser for authorization...');
    console.error('[GOOGLE_OAUTH] If browser doesn\'t open, visit this URL:');
    console.error(`[GOOGLE_OAUTH] ${authUrl}`);
    
    // Start callback server and open browser in parallel
    const [authCode] = await Promise.all([
      this.startCallbackServer(),
      open(authUrl)
    ]);

    // Exchange the authorization code for tokens
    await this.exchangeCodeForTokens(authCode);
  }

  /**
   * Exchange authorization code for tokens
   */
  private async exchangeCodeForTokens(authCode: string): Promise<void> {
    const { tokens } = await this.oauth2Client.getToken(authCode);
    await this.tokenManager.storeTokens(tokens);
    console.error('[GOOGLE_OAUTH] Authorization successful! Tokens stored.');
  }

  /**
   * Refresh expired access token
   */
  private async refreshTokens(refreshToken: string): Promise<OAuth2Tokens> {
    this.oauth2Client.setCredentials({ refresh_token: refreshToken });
    
    const { credentials } = await this.oauth2Client.refreshAccessToken();
    await this.tokenManager.storeTokens(credentials);
    
    return credentials;
  }

  /**
   * Check if token is expired (with 5-minute buffer)
   */
  private isTokenExpired(tokens: OAuth2Tokens): boolean {
    const buffer = 5 * 60 * 1000; // 5 minutes
    const expiryTime = tokens.expiry_date || 0;
    return Date.now() + buffer >= expiryTime;
  }

  /**
   * Start a local HTTP server to handle OAuth callback
   */
  private async startCallbackServer(): Promise<string> {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req: any, res: any) => {
        const queryObject = url.parse(req.url, true).query;

        if (queryObject.code) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <html>
              <body>
                <h1>Authorization successful!</h1>
                <p>You can close this window and return to your application.</p>
              </body>
            </html>
          `);

          server.close();
          resolve(queryObject.code as string);
        } else if (queryObject.error) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(`
            <html>
              <body>
                <h1>Authorization failed</h1>
                <p>Error: ${queryObject.error}</p>
              </body>
            </html>
          `);

          server.close();
          reject(new Error(`OAuth authorization failed: ${queryObject.error}`));
        } else {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('Invalid callback request');
        }
      });

      // Extract port from redirect URI
      const redirectUrl = new URL(this.redirectUri);
      const port = parseInt(redirectUrl.port || '3000');

      // Listen on the configured port
      server.listen(port, () => {
        console.error(`[GOOGLE_OAUTH] Callback server listening on ${this.redirectUri}`);
      });

      // Timeout after 5 minutes
      setTimeout(() => {
        server.close();
        reject(new Error('OAuth authorization timeout'));
      }, 5 * 60 * 1000);
    });
  }

  /**
   * Revoke tokens and clear stored credentials
   */
  async revokeTokens(): Promise<void> {
    const tokens = await this.tokenManager.getTokens();
    
    if (tokens?.access_token) {
      try {
        await this.oauth2Client.revokeToken(tokens.access_token);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.warn(`Failed to revoke token: ${errorMessage}`);
      }
    }
    
    await this.tokenManager.deleteTokens();
    console.error('OAuth tokens revoked and deleted');
  }

  /**
   * Check if user has valid authentication
   */
  async isAuthenticated(): Promise<boolean> {
    try {
      const tokens = await this.tokenManager.getTokens();
      return !!tokens?.access_token && !this.isTokenExpired(tokens);
    } catch (error) {
      return false;
    }
  }
}