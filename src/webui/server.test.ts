import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { IncomingMessage, ServerResponse } from 'node:http';
import fs from 'node:fs';
import { handleRequest, server, getTelemetryRate, setTelemetryRate } from './server.js';
import type { TelemetryData } from '../types.js';

vi.mock('node:fs');

describe('WebUI Server', () => {
  let mockReq: Partial<IncomingMessage> & { on: ReturnType<typeof vi.fn> };
  let mockRes: Partial<ServerResponse>;
  let writeHeadSpy: ReturnType<typeof vi.fn>;
  let endSpy: ReturnType<typeof vi.fn>;
  let writeSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    
    const onMock = vi.fn();
    mockReq = {
      method: 'GET',
      url: '/',
      on: onMock
    } as any;
    
    writeHeadSpy = vi.fn();
    endSpy = vi.fn();
    writeSpy = vi.fn();
    
    mockRes = {
      writeHead: writeHeadSpy,
      end: endSpy,
      write: writeSpy
    };
    
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

  describe('GET /favicon.svg and /favicon.ico', () => {
    it('should serve favicon.svg with image/svg+xml header', () => {
      mockReq.url = '/favicon.svg';
      vi.mocked(fs.readFileSync).mockReturnValue('<svg>icon</svg>');
      handleRequest(mockReq as IncomingMessage, mockRes as ServerResponse);

      expect(writeHeadSpy).toHaveBeenCalledWith(200, { 'Content-Type': 'image/svg+xml; charset=utf-8' });
      expect(endSpy).toHaveBeenCalledWith('<svg>icon</svg>');
    });

    it('should serve /favicon.ico with image/x-icon header', () => {
      mockReq.url = '/favicon.ico';
      vi.mocked(fs.readFileSync).mockReturnValue('<svg>icon</svg>');
      handleRequest(mockReq as IncomingMessage, mockRes as ServerResponse);

      expect(writeHeadSpy).toHaveBeenCalledWith(200, { 'Content-Type': 'image/x-icon' });
      expect(endSpy).toHaveBeenCalledWith('<svg>icon</svg>');
    });
  });

  describe('GET /telemetry', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      mockReq.url = '/telemetry';
      mockReq.method = 'GET';
      setTelemetryRate(1000);
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
    
    it('should send telemetry data according to telemetry rate', () => {
      handleRequest(mockReq as IncomingMessage, mockRes as ServerResponse);
      
      vi.advanceTimersByTime(1000);
      
      expect(writeSpy).toHaveBeenCalled();
      const telemetryCall = writeSpy.mock.calls[1];
      expect(telemetryCall[0]).toMatch(/^data: \{.*\}\n\n$/);
      
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
      handleRequest(mockReq as IncomingMessage, mockRes as ServerResponse);
      
      const closeCallback = mockReq.on.mock.calls.find(
        (call: any) => call[0] === 'close'
      )?.[1];
      expect(typeof closeCallback).toBe('function');
      closeCallback();
      expect(mockRes.end).toHaveBeenCalled();
    });
  });

  describe('Telemetry Rate Controls', () => {
    it('should get default rate of 1000ms', () => {
      setTelemetryRate(1000);
      expect(getTelemetryRate()).toBe(1000);
    });

    it('should update rate within bounds [100, 60000]', () => {
      expect(setTelemetryRate(500)).toBe(500);
      expect(getTelemetryRate()).toBe(500);

      expect(setTelemetryRate(50)).toBe(100); // Clamped to min 100
      expect(setTelemetryRate(100000)).toBe(60000); // Clamped to max 60000
    });
  });

  describe('POST /api/chat', () => {
    it('should reject missing message with 400', async () => {
      mockReq.url = '/api/chat';
      mockReq.method = 'POST';
      
      const onHandlers: Record<string, (...args: any[]) => void> = {};
      mockReq.on = vi.fn().mockImplementation((evt, cb) => {
        onHandlers[evt] = cb;
        return mockReq;
      });

      handleRequest(mockReq as IncomingMessage, mockRes as ServerResponse);
      
      // Emit empty body
      onHandlers['data']?.(Buffer.from(JSON.stringify({})));
      onHandlers['end']?.();

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(writeHeadSpy).toHaveBeenCalledWith(400, { 'Content-Type': 'application/json' });
      expect(endSpy).toHaveBeenCalled();
    });

    it('should process chat message with echo fallback when no handler registered', async () => {
      mockReq.url = '/api/chat';
      mockReq.method = 'POST';
      
      const onHandlers: Record<string, (...args: any[]) => void> = {};
      mockReq.on = vi.fn().mockImplementation((evt, cb) => {
        onHandlers[evt] = cb;
        return mockReq;
      });

      handleRequest(mockReq as IncomingMessage, mockRes as ServerResponse);
      
      onHandlers['data']?.(Buffer.from(JSON.stringify({ message: 'Hello Daedalus' })));
      onHandlers['end']?.();

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(writeHeadSpy).toHaveBeenCalledWith(200, { 'Content-Type': 'application/json' });
      const responseData = JSON.parse(endSpy.mock.calls[0][0]);
      expect(responseData.status).toBe('ok');
    });
  });

  describe('GET /api/files', () => {
    it('should return project tree JSON', () => {
      mockReq.url = '/api/files';
      mockReq.method = 'GET';
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fs.readdirSync).mockReturnValue([
        { name: 'src', isDirectory: () => true, isFile: () => false } as any,
        { name: 'package.json', isDirectory: () => false, isFile: () => true } as any,
      ]);

      handleRequest(mockReq as IncomingMessage, mockRes as ServerResponse);

      expect(writeHeadSpy).toHaveBeenCalledWith(200, { 'Content-Type': 'application/json' });
      expect(endSpy).toHaveBeenCalled();
      const body = JSON.parse(endSpy.mock.calls[0][0]);
      expect(body).toHaveProperty('cwd');
      expect(body).toHaveProperty('tree');
      expect(Array.isArray(body.tree)).toBe(true);
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

  describe('Server error handling', () => {
    it('should return 500 for internal server error', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error('Disk read error');
      });

      handleRequest(mockReq as IncomingMessage, mockRes as ServerResponse);

      expect(writeHeadSpy).toHaveBeenCalledWith(500, { 'Content-Type': 'application/json' });
      expect(endSpy).toHaveBeenCalled();
      const responseBody = JSON.parse(endSpy.mock.calls[0][0]);
      expect(responseBody.error).toBe('Disk read error');
    });
  });
});
