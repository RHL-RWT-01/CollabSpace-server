import { Request, Response } from "express";
import { AuthenticatedRequest } from "../middleware/auth.middleware";
import {
  summarizeText,
  generateDiagramStructure,
  analyzeWhiteboardContent,
} from "../config/openai";
import Whiteboard from "../models/Whiteboard.model";
import { Message } from "../models/Message.model";
import { Room } from "../models/Room.model";
import { logger } from "../utils/logger.util";
import type {
  SummarizeRequest,
  GenerateDiagramRequest,
} from "../types/ai.types";

interface ExtendedAuthenticatedRequest extends AuthenticatedRequest {
  body: any;
  incrementAIUsage?: () => Promise<any>;
}

export const summarizeContent = async (
  req: ExtendedAuthenticatedRequest,
  res: Response
) => {
  try {
    const {
      roomId,
      contentType,
      includeTimestamps = false,
    }: SummarizeRequest = req.body;
    const userId = req.user!.id;

    // Verify room access
    const room = await Room.findById(roomId);
    if (!room) {
      return res.status(404).json({
        success: false,
        error: "Room not found",
      });
    }

    const hasAccess = await Room.hasAccess(roomId, userId);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        error: "Access denied to this room",
      });
    }

    let combinedContent = "";
    let whiteboardInsights = "";
    let chatSummary = "";

    // Fetch whiteboard content if requested
    if (contentType === "whiteboard" || contentType === "both") {
      const whiteboard = await Whiteboard.findOne({ roomId });
      if (whiteboard && whiteboard.elements && whiteboard.elements.length > 0) {
        // Use the whiteboard analysis helper for insights
        whiteboardInsights = await analyzeWhiteboardContent(
          whiteboard.elements
        );

        const textElements = whiteboard.elements
          .filter((element: any) => element.type === "text" && element.text)
          .map((element: any) => element.text)
          .join(" ");

        if (textElements) {
          combinedContent += `Whiteboard content: ${textElements}\n\n`;
        }

        if (whiteboardInsights) {
          combinedContent += `Whiteboard analysis: ${whiteboardInsights}\n\n`;
        }
      }
    }

    // Fetch chat content if requested
    if (contentType === "chat" || contentType === "both") {
      const messages = await Message.find({ roomId })
        .populate("senderId", "name")
        .sort({ createdAt: -1 })
        .limit(100);

      if (messages.length > 0) {
        const chatContent = messages
          .reverse()
          .map((msg: any) => {
            const timestamp = includeTimestamps
              ? `[${msg.createdAt.toLocaleTimeString()}] `
              : "";
            return `${timestamp}${msg.senderId.name}: ${msg.content}`;
          })
          .join("\n");

        combinedContent += `Chat messages:\n${chatContent}`;

        // Generate separate chat summary if there's significant content
        if (chatContent.length > 200) {
          chatSummary = await summarizeText(chatContent);
        }
      }
    }

    if (!combinedContent.trim()) {
      return res.status(400).json({
        success: false,
        error: "No content found to summarize",
      });
    }

    // Generate structured summary using OpenAI
    const structuredPrompt = `Please create a structured summary of the following content. Format it with clear sections:
    
    **Key Points:**
    - [Main points from the content]
    
    **Action Items:**
    - [Any tasks, decisions, or next steps mentioned]
    
    **Additional Insights:**
    - [Other relevant observations]
    
    Content to summarize:
    ${combinedContent}`;

    const summary = await summarizeText(structuredPrompt);
    const wordCount = summary.split(" ").length;

    logger.info(
      `Generated structured summary for room ${roomId} by user ${userId}`
    );

    res.json({
      success: true,
      data: {
        summary,
        chatSummary: chatSummary || null,
        whiteboardInsights: whiteboardInsights || null,
        wordCount,
        generatedAt: new Date(),
      },
    });
  } catch (error: any) {
    logger.error("Error generating summary:", error);

    // Enhanced error handling for OpenAI API
    if (
      error?.response?.status === 429 ||
      error?.status === 429 ||
      error?.message?.includes("rate limit")
    ) {
      const retryAfter = error?.response?.headers?.["retry-after"] || 60;
      return res.status(429).header("Retry-After", retryAfter.toString()).json({
        success: false,
        error: "Rate limit exceeded. Please try again later.",
        retryAfter,
      });
    }

    if (error?.response?.status === 401 || error?.status === 401) {
      return res.status(500).json({
        success: false,
        error: "AI service authentication failed",
      });
    }

    // Log additional error details for diagnostics
    if (error?.response?.data) {
      logger.error("OpenAI API error details:", error.response.data);
    }

    res.status(500).json({
      success: false,
      error: "Failed to generate summary",
    });
  }
};

export const generateDiagram = async (
  req: ExtendedAuthenticatedRequest,
  res: Response
) => {
  try {
    const {
      roomId,
      prompt,
      diagramType = "auto",
    }: GenerateDiagramRequest = req.body;
    const userId = req.user!.id;

    if (!prompt || !prompt.trim()) {
      return res.status(400).json({
        success: false,
        error: "Prompt is required",
      });
    }

    // Verify room access
    const room = await Room.findById(roomId);
    if (!room) {
      return res.status(404).json({
        success: false,
        error: "Room not found",
      });
    }

    // Check if user has access to the room
    const hasAccess = await Room.hasAccess(roomId, userId);

    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        error: "Access denied to this room",
      });
    }

    // Generate diagram structure using OpenAI
    const diagramStructure = await generateDiagramStructure(
      prompt,
      diagramType
    );

    // Convert diagram structure to Excalidraw elements
    const elements = convertDiagramToExcalidraw(diagramStructure, diagramType);

    logger.info(
      `Generated ${diagramType} diagram for user ${userId} in room ${roomId}`
    );

    res.json({
      success: true,
      data: {
        elements,
        description: prompt,
        diagramType: diagramStructure.type || diagramType,
      },
    });
  } catch (error: any) {
    logger.error("Error generating diagram:", error);

    // Enhanced error handling for OpenAI API
    if (
      error?.response?.status === 429 ||
      error?.status === 429 ||
      error?.message?.includes("rate limit")
    ) {
      const retryAfter = error?.response?.headers?.["retry-after"] || 60;
      return res.status(429).header("Retry-After", retryAfter.toString()).json({
        success: false,
        error: "Rate limit exceeded. Please try again later.",
        retryAfter,
      });
    }

    if (error?.response?.status === 401 || error?.status === 401) {
      return res.status(500).json({
        success: false,
        error: "AI service authentication failed",
      });
    }

    if (error?.response?.status === 400 || error?.status === 400) {
      return res.status(400).json({
        success: false,
        error: "Invalid request to AI service",
      });
    }

    // Log additional error details for diagnostics
    if (error?.response?.data) {
      logger.error("OpenAI API error details:", error.response.data);
    }

    res.status(500).json({
      success: false,
      error: "Failed to generate diagram",
    });
  }
};

// Helper function to convert diagram structure to Excalidraw elements
function convertDiagramToExcalidraw(
  diagramStructure: any,
  diagramType: string
): any[] {
  const elements: any[] = [];
  let elementId = 1;
  const nodeElements = new Map<string, string>(); // Map node IDs to element IDs

  const generateId = () => `ai_${elementId++}_${Date.now()}`;
  const generateSeed = () => Math.floor(Math.random() * 2147483647);

  if (diagramStructure.nodes) {
    // Create elements for nodes with improved positioning
    diagramStructure.nodes.forEach((node: any, index: number) => {
      const shapeId = generateId();
      const textId = generateId();

      // Use provided position or calculate smart positioning
      let x, y;
      if (node.position) {
        x = node.position.x;
        y = node.position.y;
      } else {
        // Smart grid layout based on diagram type
        switch (diagramType) {
          case "mindmap":
            const angle = (index * 2 * Math.PI) / diagramStructure.nodes.length;
            const radius = 200 + (node.level || 1) * 100;
            x = 400 + Math.cos(angle) * radius;
            y = 300 + Math.sin(angle) * radius;
            break;
          case "sequence":
            x = 150 + index * 180;
            y = 100;
            break;
          default: // flowchart
            x = (index % 4) * 200 + 100;
            y = Math.floor(index / 4) * 150 + 100;
        }
      }

      // Determine shape type based on node type or diagram type
      let shapeType = "rectangle";
      let width = 140;
      let height = 80;

      if (node.type === "start" || node.type === "end") {
        shapeType = "ellipse";
        width = 120;
        height = 60;
      } else if (node.type === "decision") {
        shapeType = "diamond";
        width = 140;
        height = 100;
      } else if (diagramType === "mindmap") {
        shapeType = "ellipse";
        width = Math.max(100, (node.text?.length || 10) * 8);
        height = 60;
      }

      // Create shape element with proper styling
      const shapeElement = {
        id: shapeId,
        type: shapeType,
        x: x,
        y: y,
        width: width,
        height: height,
        angle: 0,
        strokeColor: getNodeColor(node.type, diagramType).stroke,
        backgroundColor: getNodeColor(node.type, diagramType).fill,
        fillStyle: "solid",
        strokeWidth: 2,
        strokeStyle: "solid",
        roughness: 1,
        opacity: 100,
        groupIds: [],
        frameId: null,
        roundness: shapeType === "ellipse" ? null : { type: 3 },
        seed: generateSeed(),
        versionNonce: generateSeed(),
        isDeleted: false,
        boundElements: [],
        updated: Date.now(),
        link: null,
        locked: false,
      };

      elements.push(shapeElement);

      // Create text element for node label
      const textElement = {
        id: textId,
        type: "text",
        x: x + 10,
        y: y + height / 2 - 10,
        width: width - 20,
        height: 25,
        angle: 0,
        strokeColor: "#1e1e1e",
        backgroundColor: "transparent",
        fillStyle: "solid",
        strokeWidth: 1,
        strokeStyle: "solid",
        roughness: 1,
        opacity: 100,
        groupIds: [],
        frameId: null,
        roundness: null,
        seed: generateSeed(),
        versionNonce: generateSeed(),
        isDeleted: false,
        boundElements: [],
        updated: Date.now(),
        link: null,
        locked: false,
        text: node.text || node.label || node.id || "",
        fontSize: 16,
        fontFamily: 1,
        textAlign: "center",
        verticalAlign: "middle",
        baseline: 18,
        containerId: shapeId,
        originalText: node.text || node.label || node.id || "",
        lineHeight: 1.25,
      };

      elements.push(textElement);
      nodeElements.set(node.id, shapeId);
    });

    // Create arrows for edges with proper bindings
    if (diagramStructure.edges) {
      diagramStructure.edges.forEach((edge: any) => {
        const fromNode = diagramStructure.nodes.find(
          (n: any) => n.id === edge.from
        );
        const toNode = diagramStructure.nodes.find(
          (n: any) => n.id === edge.to
        );
        const fromElementId = nodeElements.get(edge.from);
        const toElementId = nodeElements.get(edge.to);

        if (fromNode && toNode && fromElementId && toElementId) {
          const fromIndex = diagramStructure.nodes.indexOf(fromNode);
          const toIndex = diagramStructure.nodes.indexOf(toNode);

          // Calculate connection points based on node positions
          const fromX = fromNode.position?.x || (fromIndex % 4) * 200 + 100;
          const fromY =
            fromNode.position?.y || Math.floor(fromIndex / 4) * 150 + 100;
          const toX = toNode.position?.x || (toIndex % 4) * 200 + 100;
          const toY = toNode.position?.y || Math.floor(toIndex / 4) * 150 + 100;

          // Calculate arrow start and end points with proper offsets
          const startX = fromX + 70; // Center of from node
          const startY = fromY + 40;
          const endX = toX + 70; // Center of to node
          const endY = toY + 40;

          const arrowElement = {
            id: generateId(),
            type: "arrow",
            x: Math.min(startX, endX),
            y: Math.min(startY, endY),
            width: Math.abs(endX - startX),
            height: Math.abs(endY - startY),
            angle: 0,
            strokeColor: "#1971c2",
            backgroundColor: "transparent",
            fillStyle: "solid",
            strokeWidth: 2,
            strokeStyle: "solid",
            roughness: 1,
            opacity: 100,
            groupIds: [],
            frameId: null,
            roundness: { type: 2 },
            seed: generateSeed(),
            versionNonce: generateSeed(),
            isDeleted: false,
            boundElements: [],
            updated: Date.now(),
            link: null,
            locked: false,
            points: [
              [0, 0],
              [endX - Math.min(startX, endX), endY - Math.min(startY, endY)],
            ],
            lastCommittedPoint: null,
            startBinding: {
              elementId: fromElementId,
              focus: 0,
              gap: 1,
            },
            endBinding: {
              elementId: toElementId,
              focus: 0,
              gap: 1,
            },
            startArrowhead: null,
            endArrowhead: "arrow",
          };

          elements.push(arrowElement);

          // Add edge label if provided
          if (edge.label) {
            const labelX = (startX + endX) / 2 - 30;
            const labelY = (startY + endY) / 2 - 10;

            elements.push({
              id: generateId(),
              type: "text",
              x: labelX,
              y: labelY,
              width: 60,
              height: 20,
              angle: 0,
              strokeColor: "#1971c2",
              backgroundColor: "#ffffff",
              fillStyle: "solid",
              strokeWidth: 1,
              strokeStyle: "solid",
              roughness: 1,
              opacity: 100,
              groupIds: [],
              frameId: null,
              roundness: { type: 3 },
              seed: generateSeed(),
              versionNonce: generateSeed(),
              isDeleted: false,
              boundElements: [],
              updated: Date.now(),
              link: null,
              locked: false,
              text: edge.label,
              fontSize: 12,
              fontFamily: 1,
              textAlign: "center",
              verticalAlign: "middle",
              baseline: 14,
              containerId: null,
              originalText: edge.label,
              lineHeight: 1.25,
            });
          }
        }
      });
    }
  }

  return elements;
}

// Helper function to get colors based on node type and diagram type
function getNodeColor(nodeType: string, diagramType: string) {
  const colors = {
    start: { stroke: "#2f9e44", fill: "#d3f9d8" },
    end: { stroke: "#e03131", fill: "#ffe3e3" },
    process: { stroke: "#1971c2", fill: "#dbeafe" },
    decision: { stroke: "#f08c00", fill: "#fff4e6" },
    default: { stroke: "#495057", fill: "#f8f9fa" },
  };

  if (diagramType === "mindmap") {
    return { stroke: "#7c2d12", fill: "#fed7aa" };
  }

  return colors[nodeType as keyof typeof colors] || colors.default;
}

