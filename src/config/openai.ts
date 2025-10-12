import OpenAI from "openai";
import { logger } from "../utils/logger.util";
import { isAIEnabled, createMockResponse } from "../utils/feature-flags.util";

// Configuration constants
export const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-3.5-turbo";
export const OPENAI_MAX_TOKENS = parseInt(
  process.env.OPENAI_MAX_TOKENS || "500"
);
export const OPENAI_TEMPERATURE = parseFloat(
  process.env.OPENAI_TEMPERATURE || "0.7"
);

// Initialize OpenAI client only if AI is enabled
let openai: OpenAI | null = null;
if (isAIEnabled()) {
  openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY || "",
  });
}

// Helper function to summarize text
export const summarizeText = async (text: string): Promise<string> => {
  try {
    // Check if AI service is enabled
    if (!isAIEnabled()) {
      logger.info("🤖 AI service disabled - returning mock summary");
      return "AI service is currently disabled. Set ENABLE_AI=true in .env to enable AI features.";
    }

    if (!openai) {
      throw new Error("OpenAI client not initialized - check OPENAI_API_KEY");
    }

    const response = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [
        {
          role: "system",
          content:
            "You are a helpful assistant that creates concise summaries.",
        },
        {
          role: "user",
          content: `Please summarize the following text in 2-3 sentences:\n\n${text}`,
        },
      ],
      max_tokens: OPENAI_MAX_TOKENS,
      temperature: OPENAI_TEMPERATURE,
    });

    return (
      response.choices[0]?.message?.content || "Unable to generate summary"
    );
  } catch (error) {
    logger.error("Error generating summary with OpenAI:", error);
    throw error;
  }
};

// Helper function to generate diagram description
export const generateDiagramDescription = async (
  prompt: string
): Promise<string> => {
  try {
    // Check if AI service is enabled
    if (!isAIEnabled()) {
      logger.info(
        "🤖 AI service disabled - returning mock diagram description"
      );
      return "AI service is currently disabled. Set ENABLE_AI=true in .env to enable AI features.";
    }

    if (!openai) {
      throw new Error("OpenAI client not initialized - check OPENAI_API_KEY");
    }

    const response = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [
        {
          role: "system",
          content:
            "You are a helpful assistant that creates detailed descriptions for diagrams and flowcharts based on user requirements.",
        },
        {
          role: "user",
          content: `Create a detailed description for a diagram based on this requirement: ${prompt}`,
        },
      ],
      max_tokens: OPENAI_MAX_TOKENS * 2,
      temperature: OPENAI_TEMPERATURE,
    });

    return (
      response.choices[0]?.message?.content ||
      "Unable to generate diagram description"
    );
  } catch (error) {
    logger.error("Error generating diagram description with OpenAI:", error);
    throw error;
  }
};

// Helper function to analyze whiteboard content
export const analyzeWhiteboardContent = async (
  elements: any[]
): Promise<string> => {
  try {
    // Check if AI service is enabled
    if (!isAIEnabled()) {
      logger.info(
        "🤖 AI service disabled - returning mock whiteboard analysis"
      );
      return "AI service is currently disabled. Set ENABLE_AI=true in .env to enable AI features.";
    }

    if (!openai) {
      throw new Error("OpenAI client not initialized - check OPENAI_API_KEY");
    }

    const textElements = elements
      .filter((element) => element.type === "text")
      .map((element) => element.text)
      .join(" ");

    if (!textElements.trim()) {
      return "No text content found in the whiteboard to analyze.";
    }

    const response = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [
        {
          role: "system",
          content:
            "You are a helpful assistant that analyzes whiteboard content and provides insights.",
        },
        {
          role: "user",
          content: `Analyze this whiteboard content and provide insights:\n\n${textElements}`,
        },
      ],
      max_tokens: OPENAI_MAX_TOKENS,
      temperature: OPENAI_TEMPERATURE,
    });

    return (
      response.choices[0]?.message?.content ||
      "Unable to analyze whiteboard content"
    );
  } catch (error) {
    logger.error("Error analyzing whiteboard content with OpenAI:", error);
    throw error;
  }
};

// Helper function to generate diagram structure
export const generateDiagramStructure = async (
  prompt: string,
  diagramType: "flowchart" | "mindmap" | "sequence" | "auto"
): Promise<any> => {
  try {
    // Check if AI service is enabled
    if (!isAIEnabled()) {
      logger.info("🤖 AI service disabled - returning mock diagram structure");
      return {
        type: diagramType,
        nodes: [
          {
            id: "1",
            text: "AI service disabled",
            position: { x: 400, y: 300 },
            type: "process",
          },
        ],
        edges: [],
        message: "Set ENABLE_AI=true in .env to enable AI diagram generation",
      };
    }

    if (!openai) {
      throw new Error("OpenAI client not initialized - check OPENAI_API_KEY");
    }

    let systemContent = "";

    switch (diagramType) {
      case "flowchart":
        systemContent = `You are a diagram generator that creates flowchart structures. Return a JSON object with:
        {
          "type": "flowchart",
          "nodes": [{"id": "unique_id", "text": "Node text", "position": {"x": number, "y": number}, "type": "start|process|decision|end"}],
          "edges": [{"from": "node_id", "to": "node_id", "label": "optional label"}]
        }
        Position nodes in a logical flow from top to bottom. Use x: 0-800, y: 0-600 coordinates.`;
        break;
      case "mindmap":
        systemContent = `You are a diagram generator that creates mindmap structures. Return a JSON object with:
        {
          "type": "mindmap",
          "nodes": [{"id": "unique_id", "text": "Node text", "position": {"x": number, "y": number}, "level": number}],
          "edges": [{"from": "parent_id", "to": "child_id"}]
        }
        Center the main topic at x:400, y:300. Branch child nodes around it. Use levels 0 (center) to 3 (outer).`;
        break;
      case "sequence":
        systemContent = `You are a diagram generator that creates sequence diagram structures. Return a JSON object with:
        {
          "type": "sequence",
          "actors": [{"id": "unique_id", "name": "Actor name", "position": {"x": number, "y": 50}}],
          "messages": [{"from": "actor_id", "to": "actor_id", "text": "Message text", "y": number}]
        }
        Space actors horizontally. Messages flow top to bottom with increasing y values.`;
        break;
      default:
        systemContent = `You are a diagram generator that analyzes the prompt and creates the most appropriate diagram structure. Return a JSON object with:
        {
          "type": "flowchart|mindmap|sequence",
          "nodes": [{"id": "unique_id", "text": "Node text", "position": {"x": number, "y": number}}],
          "edges": [{"from": "node_id", "to": "node_id", "label": "optional label"}]
        }
        Choose the diagram type that best represents the content. Position elements logically.`;
    }

    const response = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [
        {
          role: "system",
          content: systemContent,
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: OPENAI_TEMPERATURE,
      max_tokens: OPENAI_MAX_TOKENS * 2,
      response_format: { type: "json_object" },
    });

    const json = JSON.parse(response.choices[0].message?.content ?? "{}");
    return json;
  } catch (error) {
    logger.error("Error generating diagram structure with OpenAI:", error);
    throw error;
  }
};

