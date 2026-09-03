import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { IncomingMessage, ServerResponse } from 'node:http';
import fs from 'node:fs';
import { handleRequest, server, TelemetryData } from './server.js';

// Mock dependencies
vi.mock('node:fs');

describe('WebUI Server', () => {
  let mockReq: Partial<IncomingMessage> & { on: ReturnType<typeof vi.fn> };
  let mockRes: Partial<ServerResponse>;
  let writeHeadSpy: ReturnType<typeof vi.fn>;
  let endSpy: ReturnType<typeof vi.fn>;
  let writeSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Setup mock request
    const onMock = vi.fn();
    mockReq = {
      method: 'GET',
      url: '/',
      on: onMock
    } as any;
    
    // Setup mock response
    writeHeadSpy = vi.fn();
    endSpy = vi.fn();
    writeSpy = vi.fn();
    
    mockRes = {
      writeHead: writeHeadSpy,
      end: endSpy,
      write: writeSpy
    };
    
    // Mock fs.existsSync to return true for index.html
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('<html>Mock HTML</html>');
  });

  describe('GET /', () => {
    it('should serve index.html when file exists', () => {
      handleRequest(mockReq as IncomingMessage, mockRes as ServerResponse);
      
      expect(writeHeadSpy).toHaveBeenCalledWith(200, { 'Content-Type': 'text/html; charset=utf-8' });
      expect(endSpy).toHaveBeenCalledWith('<html>Mock HTML</html>');
    });
    
    it('should return OK when index.html does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      handleRequest(mockReq as IncomingMessage, mockRes as ServerResponse);
      
      expect(writeHeadSpy).toHaveBeenCalledWith(200, { 'Content-Type': 'text/plain' });
      expect(endSpy).toHaveBeenCalledWith('OK');
    });
  });

  describe('GET /telemetry', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      mockReq.url = '/telemetry';
      mockReq.method = 'GET';
    });

    afterEach(() => {
      vi.useRealTimers();
    });
    
    it('should establish telemetry stream connection', () => {
      handleRequest(mockReq as IncomingMessage, mockRes as ServerResponse);
      
      expect(writeHeadSpy).toHaveBeenCalledWith(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
      });
      expect(writeSpy).toHaveBeenCalledWith('data: {"type":"connected"}\n\n');
    });
    
    it('should send telemetry data every second', () => {
      handleRequest(mockReq as IncomingMessage, mockRes as ServerResponse);
      
      // Fast-forward time to trigger interval
      vi.advanceTimersByTime(1000);
      
      expect(writeSpy).toHaveBeenCalled();
      const telemetryCall = writeSpy.mock.calls[1];
      expect(telemetryCall[0]).toMatch(/^data: \{.*\}\n\n$/);
      
      // Verify data structure
      const dataStr = telemetryCall[0];
      const dataMatch = dataStr.match(/data: (\{.*\})\n\n/);
      if (dataMatch) {
        const data = JSON.parse(dataMatch[1]);
        expect(data).toHaveProperty('timestamp');
        expect(data).toHaveProperty('metric');
        expect(data).toHaveProperty('value');
        expect(['cpu', 'memory', 'disk', 'network']).toContain(data.metric);
        expect(data.value).toBeGreaterThanOrEqual(0);
        expect(data.value).toBeLessThanOrEqual(100);
      }
    });
    
    it('should clean up interval on client disconnect', () => {
      const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
      
      handleRequest(mockReq as IncomingMessage, mockRes as ServerResponse);
      
      // Simulate client disconnect
      const closeCallback = mockReq.on.mock.calls.find(
        (call: any) => call[0] === 'close'
      )?.[1];
      if (closeCallback) {
        closeCallback();
      }
      
      expect(clearIntervalSpy).toHaveBeenCalled();
    });
  });

  describe('Other routes', () => {
    it('should return 404 for unknown routes', () => {
      mockReq.url = '/unknown';
      mockReq.method = 'GET';
      handleRequest(mockReq as IncomingMessage, mockRes as ServerResponse);
      
      expect(writeHeadSpy).toHaveBeenCalledWith(404, { 'Content-Type': 'text/plain' });
      expect(endSpy).toHaveBeenCalledWith('Not Found');
    });
    
    it('should return 404 for non-GET methods', () => {
      mockReq.url = '/';
      mockReq.method = 'POST';
      handleRequest(mockReq as IncomingMessage, mockRes as ServerResponse);
      
      expect(writeHeadSpy).toHaveBeenCalledWith(404, { 'Content-Type': 'text/plain' });
      expect(endSpy).toHaveBeenCalledWith('Not Found');
    });
  });

  describe('Server initialization', () => {
    it('should create server instance', () => {
      expect(server).toBeDefined();
      expect(typeof server.listen).toBe('function');
    });
    
    it('should export server instance', () => {
      expect(server).toBeDefined();
    });
  });

  describe('TelemetryData interface', () => {
    it('should have correct structure', () => {
      const data: TelemetryData = {
        timestamp: Date.now(),
        metric: 'cpu',
        value: 50
      };
      
      expect(data).toHaveProperty('timestamp');
      expect(data).toHaveProperty('metric');
      expect(data).toHaveProperty('value');
      expect(typeof data.timestamp).toBe('number');
      expect(typeof data.metric).toBe('string');
      expect(typeof data.value).toBe('number');
    });
  });
});