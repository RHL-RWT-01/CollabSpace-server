export interface SummarizeRequest {
  roomId: string;
  contentType: "whiteboard" | "chat" | "both";
  includeTimestamps?: boolean;
}

export interface SummarizeResponse {
  summary: string;
  wordCount: number;
  generatedAt: Date;
}

export interface GenerateDiagramRequest {
  roomId: string;
  prompt: string;
  diagramType: "flowchart" | "mindmap" | "sequence" | "auto";
  style?: any;
}

export interface GenerateDiagramResponse {
  elements: any[];
  description: string;
  diagramType: string;
}

export interface DiagramNode {
  id: string;
  label: string;
  type: string;
  position: {
    x: number;
    y: number;
  };
}

export interface DiagramEdge {
  from: string;
  to: string;
  label?: string;
  type: "arrow" | "line";
}

export interface AIError {
  code: string;
  message: string;
  details?: any;
}

