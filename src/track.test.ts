import { describe, it, beforeEach, jest, expect } from '@jest/globals';
import { TrackManager } from './track';
import {
  promptLayerTrackGroup,
  promptLayerTrackMetadata,
  promptLayerTrackPrompt,
  promptLayerTrackScore,
} from "@/utils";

jest.mock("@/utils", () => ({
  promptLayerTrackGroup: jest.fn(),
  promptLayerTrackMetadata: jest.fn(),
  promptLayerTrackPrompt: jest.fn(),
  promptLayerTrackScore: jest.fn(),
}));

describe('TrackManager', () => {
  const apiKey = 'test-api-key';
  let trackManager: TrackManager;

  beforeEach(() => {
    trackManager = new TrackManager(apiKey);
    jest.clearAllMocks();
  });

  describe('metadata', () => {
    it('should successfully track metadata with valid input', async () => {
      const validMetadata = {
        request_id: 123,
        metadata: {
          key1: 'value1',
          key2: 'value2',
        },
      };

      jest.mocked(promptLayerTrackMetadata).mockResolvedValue(true);

      const result = await trackManager.metadata(validMetadata);
      expect(result).toBe(true);
      expect(promptLayerTrackMetadata).toHaveBeenCalledWith(apiKey, validMetadata);
    });

    it('should throw error when metadata is not a valid object', async () => {
      const invalidMetadata = {
        request_id: '123',
        metadata: 'invalid',
      };

      await expect(async () => {
        await trackManager.metadata(invalidMetadata as any);
      }).rejects.toThrow('Please provide a dictionary of metadata.');
    });

    it('should throw error when metadata contains non-string values', async () => {
      const invalidMetadata = {
        request_id: '123',
        metadata: {
          key1: 123,
          key2: 'value2',
        },
      };

      await expect(async () => {
        await trackManager.metadata(invalidMetadata as any);
      }).rejects.toThrow('Please provide a dictionary of metadata with key value pair of strings.');
    });
  });

  describe('score', () => {
    it('should successfully track score with valid input', async () => {
      const validScore = {
        request_id: 123,
        score: 75,
      };

      jest.mocked(promptLayerTrackScore).mockResolvedValue(true);

      const result = await trackManager.score(validScore);
      expect(result).toBe(true);
      expect(promptLayerTrackScore).toHaveBeenCalledWith(apiKey, validScore);
    });

    it('should throw error when score is not a number', async () => {
      const invalidScore = {
        request_id: '123',
        score: '75',
      };

      await expect(async () => {
        await trackManager.score(invalidScore as any);
      }).rejects.toThrow('Score must be a number');
    });

    it('should throw error when score is out of range', async () => {
      const invalidScore = {
        request_id: '123',
        score: 101,
      };

      await expect(async () => {
        await trackManager.score(invalidScore as any);
      }).rejects.toThrow('Score must be a number between 0 and 100.');
    });
  });

  describe('prompt', () => {
    it('should successfully track prompt with valid input', async () => {
      const validPrompt = {
        request_id: '123',
        prompt_input_variables: {
          template: 'Hello {{name}}',
          variables: { name: 'World' },
        },
      };

      jest.mocked(promptLayerTrackPrompt).mockResolvedValue(true);

      const result = await trackManager.prompt(validPrompt as any);
      expect(result).toBe(true);
      expect(promptLayerTrackPrompt).toHaveBeenCalledWith(apiKey, validPrompt);
    });

    it('should throw error when prompt_input_variables is not an object', async () => {
      const invalidPrompt = {
        request_id: '123',
        prompt_input_variables: 'invalid',
      };

      await expect(async () => {
        await trackManager.prompt(invalidPrompt as any);
      }).rejects.toThrow('Prompt template input variable dictionary not provided.');
    });
  });

  describe('group', () => {
    it('should successfully track group with valid input', async () => {
      const validGroup = {
        request_id: '123',
        group_id: 'group1',
      };

      jest.mocked(promptLayerTrackGroup).mockResolvedValue(true);

      const result = await trackManager.group(validGroup as any);
      expect(result).toBe(true);
      expect(promptLayerTrackGroup).toHaveBeenCalledWith(apiKey, validGroup);
    });
  });
});
