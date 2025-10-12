// Helper function to generate thumbnail metadata from whiteboard elements
export const generateThumbnailFromElements = (
  elements: any[],
  appState: any,
  width: number = 300,
  height: number = 200
) => {
  if (!elements || elements.length === 0) {
    return {
      width,
      height,
      isEmpty: true,
      elementCount: 0,
      backgroundColor: appState?.viewBackgroundColor || '#ffffff',
    };
  }

  // Calculate bounding box of all elements
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const validElements = elements.filter(
    (el) => el && typeof el.x === 'number' && typeof el.y === 'number'
  );

  validElements.forEach((element) => {
    const elementMinX = element.x;
    const elementMinY = element.y;
    const elementMaxX = element.x + (element.width || 0);
    const elementMaxY = element.y + (element.height || 0);

    minX = Math.min(minX, elementMinX);
    minY = Math.min(minY, elementMinY);
    maxX = Math.max(maxX, elementMaxX);
    maxY = Math.max(maxY, elementMaxY);
  });

  // If no valid elements found
  if (!isFinite(minX)) {
    return {
      width,
      height,
      isEmpty: true,
      elementCount: 0,
      backgroundColor: appState?.viewBackgroundColor || '#ffffff',
    };
  }

  const contentWidth = maxX - minX;
  const contentHeight = maxY - minY;

  // Calculate scale to fit content in thumbnail
  const scaleX = width / contentWidth;
  const scaleY = height / contentHeight;
  const scale = Math.min(scaleX, scaleY, 1); // Don't scale up

  // Generate simplified element data for client-side rendering
  const thumbnailElements = validElements.map((element) => ({
    id: element.id,
    type: element.type,
    x: (element.x - minX) * scale,
    y: (element.y - minY) * scale,
    width: (element.width || 0) * scale,
    height: (element.height || 0) * scale,
    strokeColor: element.strokeColor || '#000000',
    backgroundColor: element.backgroundColor || 'transparent',
    text: element.type === 'text' ? element.text : undefined,
  }));

  return {
    width,
    height,
    scale,
    isEmpty: false,
    elementCount: validElements.length,
    contentBounds: { minX, minY, maxX, maxY },
    backgroundColor: appState?.viewBackgroundColor || '#ffffff',
    elements: thumbnailElements,
  };
};

// Future enhancement: Server-side canvas rendering
export const generateThumbnailDataUrl = async (
  elements: any[],
  appState: any,
  width: number = 300,
  height: number = 200
): Promise<string | null> => {
  // This would require a server-side canvas library like 'canvas' or 'sharp'
  // For now, return null to indicate client-side rendering should be used
  return null;
};
