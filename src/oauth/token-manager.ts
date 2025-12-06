import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

export interface OAuth2Tokens {
  access_token?: string | null;
  refresh_token?: string | null;
  expiry_date?: number | null;
  scope?: string | null;
  token_type?: string | null;
}

export class TokenManager {
  private readonly tokenPath: string;
  private readonly provider: string;

  constructor(provider?: string) {
    // Use provided provider or extract from template context
    this.provider = provider || 'default';
    
    // Dynamic token path based on provider
    this.tokenPath = path.join(os.homedir(), '.mcp', `${this.provider}-tokens`);
    
    this.ensureTokenDirectory();
  }

  /**
   * Store OAuth tokens securely
   */
  async storeTokens(tokens: OAuth2Tokens, userId = 'default'): Promise<void> {
    const tokenFile = path.join(this.tokenPath, `${userId}.json`);
    
    console.error(`[TOKEN_STORAGE] 🔐 Starting token storage process...`);
    console.error(`[TOKEN_STORAGE] 🏷️  Provider: ${this.provider}`);
    console.error(`[TOKEN_STORAGE] 📁 Storage directory: ${this.tokenPath}`);
    console.error(`[TOKEN_STORAGE] 📄 Token file path: ${tokenFile}`);
    console.error(`[TOKEN_STORAGE] 👤 User ID: ${userId}`);
    console.error(`[TOKEN_STORAGE] 🔑 Token preview: ${tokens.access_token ? tokens.access_token.substring(0, 12) + '...' : 'null'}`);
    
    try {
      // Try platform keychain first
      console.error(`[TOKEN_STORAGE] 🔐 Attempting encryption...`);
      const encryptedData = await this.encryptTokenData(tokens);
      
      // Write with secure permissions
      console.error(`[TOKEN_STORAGE] 💾 Writing encrypted tokens to file system...`);
      await fs.writeFile(tokenFile, encryptedData, { mode: 0o600 });
      
      console.error(`[TOKEN_STORAGE] ✅ Tokens stored successfully!`);
      console.error(`[TOKEN_STORAGE] 📍 Final storage location: ${tokenFile}`);
      console.error(`[TOKEN_STORAGE] 🔒 File permissions: 0o600 (owner read/write only)`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[TOKEN_STORAGE] ❌ Token storage failed: ${errorMessage}`);
      throw new Error(`Token storage failed: ${errorMessage}`);
    }
  }

  /**
   * Retrieve stored OAuth tokens
   */
  async getTokens(userId = 'default'): Promise<OAuth2Tokens | null> {
    const tokenFile = path.join(this.tokenPath, `${userId}.json`);
    
    console.error(`[TOKEN_RETRIEVAL] 🔍 Looking for stored tokens...`);
    console.error(`[TOKEN_RETRIEVAL] 🏷️  Provider: ${this.provider}`);
    console.error(`[TOKEN_RETRIEVAL] 📁 Search directory: ${this.tokenPath}`);
    console.error(`[TOKEN_RETRIEVAL] 📄 Token file path: ${tokenFile}`);
    console.error(`[TOKEN_RETRIEVAL] 👤 User ID: ${userId}`);
    
    if (!await fs.pathExists(tokenFile)) {
      console.error(`[TOKEN_RETRIEVAL] ❌ No token file found at: ${tokenFile}`);
      console.error(`[TOKEN_RETRIEVAL] 🔄 This will trigger new OAuth authentication flow`);
      return null;
    }

    try {
      console.error(`[TOKEN_RETRIEVAL] ✅ Token file found! Reading encrypted data...`);
      const encryptedData = await fs.readFile(tokenFile, 'utf8');
      console.error(`[TOKEN_RETRIEVAL] 🔐 Decrypting stored tokens...`);
      const tokens = await this.decryptTokenData(encryptedData);
      console.error(`[TOKEN_RETRIEVAL] 🎉 Tokens successfully retrieved from storage!`);
      console.error(`[TOKEN_RETRIEVAL] 🔑 Token preview: ${tokens.access_token ? tokens.access_token.substring(0, 12) + '...' : 'null'}`);
      console.error(`[TOKEN_RETRIEVAL] 📍 Retrieved from: ${tokenFile}`);
      return tokens;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[TOKEN_RETRIEVAL] ❌ Failed to retrieve tokens: ${errorMessage}`);
      console.error(`[TOKEN_RETRIEVAL] 📄 File location: ${tokenFile}`);
      return null;
    }
  }

  /**
   * Delete stored tokens
   */
  async deleteTokens(userId = 'default'): Promise<void> {
    const tokenFile = path.join(this.tokenPath, `${userId}.json`);
    
    try {
      if (await fs.pathExists(tokenFile)) {
        await fs.remove(tokenFile);
        console.error(`[TOKEN_MANAGER] Tokens deleted for user: ${userId}`);
      }

      // Also try to delete from keychain if used
      await this.deleteFromKeychain(userId);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`Failed to delete tokens: ${errorMessage}`);
      throw new Error(`Token deletion failed: ${errorMessage}`);
    }
  }

  /**
   * Encrypt token data using platform keychain or file-based encryption
   */
  private async encryptTokenData(tokens: OAuth2Tokens): Promise<string> {
    try {
      // Try platform keychain first
      console.error(`[TOKEN_ENCRYPTION] 🔐 Attempting keychain storage...`);
      const result = await this.encryptWithKeychain(tokens);
      console.error(`[TOKEN_ENCRYPTION] ✅ Using KEYCHAIN storage (more secure)`);
      return result;
    } catch (error) {
      console.error(`[TOKEN_ENCRYPTION] ⚠️ Keychain not available, falling back to file encryption`);
      console.error(`[TOKEN_ENCRYPTION] 🔐 Using FILE-BASED encryption with AES-256-GCM`);
      return this.encryptTokenDataFile(tokens);
    }
  }

  /**
   * Decrypt token data from platform keychain or file
   */
  private async decryptTokenData(encryptedData: string): Promise<OAuth2Tokens> {
    try {
      const reference = JSON.parse(encryptedData);
      
      if (reference.type === 'keychain') {
        return await this.decryptFromKeychain(reference);
      } else {
        return this.decryptTokenDataFile(encryptedData);
      }
    } catch (error) {
      // Fallback to file decryption
      return this.decryptTokenDataFile(encryptedData);
    }
  }

  /**
   * Platform keychain encryption (macOS/Windows/Linux)
   */
  private async encryptWithKeychain(tokens: OAuth2Tokens): Promise<string> {
    try {
      const keytar = await import('keytar');
      const serviceName = 'mcp-oauth-tokens';
      const accountName = `${this.provider}-default`;
      
      const serializedData = JSON.stringify(tokens);
      await keytar.setPassword(serviceName, accountName, serializedData);
      
      // Return encrypted reference
      return JSON.stringify({ 
        type: 'keychain',
        service: serviceName,
        account: accountName 
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Keychain encryption failed: ${errorMessage}`);
    }
  }

  /**
   * Platform keychain decryption
   */
  private async decryptFromKeychain(reference: any): Promise<OAuth2Tokens> {
    try {
      const keytar = await import('keytar');
      const tokenData = await keytar.getPassword(reference.service, reference.account);
      
      if (!tokenData) {
        throw new Error('No data found in keychain');
      }
      
      return JSON.parse(tokenData);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Keychain decryption failed: ${errorMessage}`);
    }
  }

  /**
   * Delete from keychain
   */
  private async deleteFromKeychain(userId: string): Promise<void> {
    try {
      const keytar = await import('keytar');
      const serviceName = 'mcp-oauth-tokens';
      const accountName = `${this.provider}-${userId}`;
      
      await keytar.deletePassword(serviceName, accountName);
    } catch (error) {
      // Ignore errors, keychain might not be available
    }
  }

  /**
   * Fallback file-based encryption
   */
  private encryptTokenDataFile(tokens: OAuth2Tokens): string {
    const algorithm = 'aes-256-gcm';
    const key = this.getDerivedKey();
    
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(algorithm, key, iv);
    
    let encrypted = cipher.update(JSON.stringify(tokens), 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    return JSON.stringify({
      type: 'file',
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex'),
      data: encrypted
    });
  }

  /**
   * Fallback file-based decryption
   */
  private decryptTokenDataFile(encryptedData: string): OAuth2Tokens {
    const algorithm = 'aes-256-gcm';
    const key = this.getDerivedKey();
    
    const encrypted = JSON.parse(encryptedData);
    const decipher = crypto.createDecipheriv(algorithm, key, Buffer.from(encrypted.iv, 'hex'));
    
    decipher.setAuthTag(Buffer.from(encrypted.authTag, 'hex'));
    
    let decrypted = decipher.update(encrypted.data, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return JSON.parse(decrypted);
  }

  /**
   * Derive encryption key from system-specific data
   */
  private getDerivedKey(): Buffer {
    const systemInfo = `${os.hostname()}-${os.userInfo().username}`;
    return crypto.pbkdf2Sync('mcp-oauth', systemInfo, 100000, 32, 'sha512');
  }

  /**
   * Ensure token directory exists with secure permissions
   */
  private async ensureTokenDirectory(): Promise<void> {
    try {
      await fs.ensureDir(this.tokenPath, { mode: 0o700 });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`Failed to create token directory: ${errorMessage}`);
      throw new Error(`Token directory creation failed: ${errorMessage}`);
    }
  }
}