/* Generated from shared/schema/lesson.schema.json. Do not edit. */

export type ElementId = string;
export type LessonOp =
  TextOp | EquationOp | SketchOp | AxesOp | CurveOp | DiagramOp | LineOp | ArrowOp | PointOp | AngleArcOp | FigureOp;
export type TextOp = TextRegionOp | TextAnchorOp;
export type Region =
  "A1" | "A2" | "A3" | "B1" | "B2" | "B3" | "C1" | "C2" | "C3" | "D1" | "D2" | "D3" | "left" | "right" | "full";
export type EquationOp = EquationRegionOp | EquationAnchorOp;
/**
 * @minItems 2
 * @maxItems 2
 */
export type NormalizedPoint = [number, number];
export type DiagramPrimitive =
  | DiagramLinePrimitive
  | DiagramSmoothPrimitive
  | DiagramRectPrimitive
  | DiagramEllipsePrimitive
  | DiagramArcPrimitive
  | DiagramTextPrimitive
  | DiagramPointPrimitive;
export type StrokeStyle = "solid" | "dashed";
export type LineOp = LineRegionOp | LineCanvasOp | LineConstructionOp;
export type LineConstruction = PerpendicularConstruction | TangentConstruction;
export type GeometryPointReference =
  | {
      kind: "point";
      element_id: ElementId;
    }
  | {
      kind: "endpoint";
      element_id: ElementId;
      endpoint: "start" | "end";
    };
export type ArrowOp = ArrowRegionOp | ArrowCanvasOp;
export type PointOp = PointRegionOp | PointCanvasOp | PointConstructionOp;
export type PointConstruction =
  AlongConstruction | MidpointConstruction | IntersectionConstruction | OffsetConstruction;
export type AngleArcOp = AngleArcRegionOp | AngleArcCanvasOp;
export type FigureOp = FigureRegionOp | FigureOnOp;
/**
 * @minItems 2
 * @maxItems 2
 */
export type FigureRange = [FigureNumber, FigureNumber];
export type FigureNumber = number;
export type FigureMark = FigureLeafMark | FigureGroupMark;
export type FigureLeafMark =
  | FigurePointMark
  | FigureSegmentMark
  | FigurePolylineMark
  | FigureCircleMark
  | FigureArcMark
  | FigureFnMark
  | FigureParamMark
  | FigurePolarMark
  | FigureShadeUnderMark
  | FigureShadeBetweenMark
  | FigureShadeInsideMark
  | FigureAngleMark
  | FigureTangentMark
  | FigurePerpendicularMark
  | FigureMeasureMark
  | FigureTextMark;
export type FigurePoint =
  | FigureRange
  | {
      at: ElementId;
    }
  | {
      /**
       * @minItems 2
       * @maxItems 2
       */
      mid: [ElementId, ElementId];
    }
  | {
      on: ElementId;
      x: FigureNumber;
    }
  | {
      on: ElementId;
      t: number;
    }
  | {
      /**
       * @minItems 2
       * @maxItems 2
       */
      hit: [ElementId, ElementId];
    }
  | {
      foot: ElementId;
      onto: ElementId;
    };
export type LayoutRelation = LayoutPlace | LayoutAlign | LayoutStack | LayoutDistribute;

/**
 * CHALK M2 deterministic lesson wire contract.
 */
export interface LessonProgram {
  schema_version: "1.0" | "1.1" | "1.2" | "1.3" | "1.4" | "1.5";
  title: string;
  /**
   * @minItems 1
   * @maxItems 8
   */
  steps:
    | [LessonStep]
    | [LessonStep, LessonStep]
    | [LessonStep, LessonStep, LessonStep]
    | [LessonStep, LessonStep, LessonStep, LessonStep]
    | [LessonStep, LessonStep, LessonStep, LessonStep, LessonStep]
    | [LessonStep, LessonStep, LessonStep, LessonStep, LessonStep, LessonStep]
    | [LessonStep, LessonStep, LessonStep, LessonStep, LessonStep, LessonStep, LessonStep]
    | [LessonStep, LessonStep, LessonStep, LessonStep, LessonStep, LessonStep, LessonStep, LessonStep];
}
export interface LessonStep {
  id: ElementId;
  script: string;
  /**
   * @minItems 1
   * @maxItems 4
   */
  ops: [LessonOp] | [LessonOp, LessonOp] | [LessonOp, LessonOp, LessonOp] | [LessonOp, LessonOp, LessonOp, LessonOp];
  /**
   * @minItems 1
   * @maxItems 8
   */
  layout?:
    | [LayoutRelation]
    | [LayoutRelation, LayoutRelation]
    | [LayoutRelation, LayoutRelation, LayoutRelation]
    | [LayoutRelation, LayoutRelation, LayoutRelation, LayoutRelation]
    | [LayoutRelation, LayoutRelation, LayoutRelation, LayoutRelation, LayoutRelation]
    | [LayoutRelation, LayoutRelation, LayoutRelation, LayoutRelation, LayoutRelation, LayoutRelation]
    | [LayoutRelation, LayoutRelation, LayoutRelation, LayoutRelation, LayoutRelation, LayoutRelation, LayoutRelation]
    | [
        LayoutRelation,
        LayoutRelation,
        LayoutRelation,
        LayoutRelation,
        LayoutRelation,
        LayoutRelation,
        LayoutRelation,
        LayoutRelation
      ];
  checkpoint: null | Checkpoint;
}
export interface TextRegionOp {
  op: "text";
  id: ElementId;
  region: Region;
  content: string;
}
export interface TextAnchorOp {
  op: "text";
  id: ElementId;
  anchor: Anchor;
  content: string;
}
export interface Anchor {
  el: ElementId;
  side: "above" | "below" | "left" | "right";
  gap?: number;
}
export interface EquationRegionOp {
  op: "equation";
  id: ElementId;
  region: Region;
  latex: string;
}
export interface EquationAnchorOp {
  op: "equation";
  id: ElementId;
  anchor: Anchor;
  latex: string;
}
export interface SketchOp {
  op: "sketch";
  id: ElementId;
  region: Region;
  meaning?: string;
  /**
   * @minItems 1
   * @maxItems 6
   */
  strokes:
    | [[NormalizedPoint, NormalizedPoint, ...NormalizedPoint[]]]
    | [
        [NormalizedPoint, NormalizedPoint, ...NormalizedPoint[]],
        [NormalizedPoint, NormalizedPoint, ...NormalizedPoint[]]
      ]
    | [
        [NormalizedPoint, NormalizedPoint, ...NormalizedPoint[]],
        [NormalizedPoint, NormalizedPoint, ...NormalizedPoint[]],
        [NormalizedPoint, NormalizedPoint, ...NormalizedPoint[]]
      ]
    | [
        [NormalizedPoint, NormalizedPoint, ...NormalizedPoint[]],
        [NormalizedPoint, NormalizedPoint, ...NormalizedPoint[]],
        [NormalizedPoint, NormalizedPoint, ...NormalizedPoint[]],
        [NormalizedPoint, NormalizedPoint, ...NormalizedPoint[]]
      ]
    | [
        [NormalizedPoint, NormalizedPoint, ...NormalizedPoint[]],
        [NormalizedPoint, NormalizedPoint, ...NormalizedPoint[]],
        [NormalizedPoint, NormalizedPoint, ...NormalizedPoint[]],
        [NormalizedPoint, NormalizedPoint, ...NormalizedPoint[]],
        [NormalizedPoint, NormalizedPoint, ...NormalizedPoint[]]
      ]
    | [
        [NormalizedPoint, NormalizedPoint, ...NormalizedPoint[]],
        [NormalizedPoint, NormalizedPoint, ...NormalizedPoint[]],
        [NormalizedPoint, NormalizedPoint, ...NormalizedPoint[]],
        [NormalizedPoint, NormalizedPoint, ...NormalizedPoint[]],
        [NormalizedPoint, NormalizedPoint, ...NormalizedPoint[]],
        [NormalizedPoint, NormalizedPoint, ...NormalizedPoint[]]
      ];
}
export interface AxesOp {
  op: "axes";
  id: ElementId;
  region: Region;
  x: AxisSpec;
  y: AxisSpec;
}
export interface AxisSpec {
  min: number;
  max: number;
  label: string;
}
export interface CurveOp {
  op: "curve";
  id: ElementId;
  axes_id: ElementId;
  expr: string;
  /**
   * @minItems 2
   * @maxItems 2
   */
  domain?: [number, number];
}
export interface DiagramOp {
  op: "diagram";
  id: ElementId;
  region: Region;
  /**
   * @minItems 1
   * @maxItems 16
   */
  primitives:
    | [DiagramPrimitive]
    | [DiagramPrimitive, DiagramPrimitive]
    | [DiagramPrimitive, DiagramPrimitive, DiagramPrimitive]
    | [DiagramPrimitive, DiagramPrimitive, DiagramPrimitive, DiagramPrimitive]
    | [DiagramPrimitive, DiagramPrimitive, DiagramPrimitive, DiagramPrimitive, DiagramPrimitive]
    | [DiagramPrimitive, DiagramPrimitive, DiagramPrimitive, DiagramPrimitive, DiagramPrimitive, DiagramPrimitive]
    | [
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive
      ]
    | [
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive
      ]
    | [
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive
      ]
    | [
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive
      ]
    | [
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive
      ]
    | [
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive
      ]
    | [
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive
      ]
    | [
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive
      ]
    | [
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive
      ]
    | [
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive,
        DiagramPrimitive
      ];
  tension?: number;
}
export interface DiagramLinePrimitive {
  kind: "line";
  /**
   * @minItems 2
   * @maxItems 12
   */
  points:
    | [NormalizedPoint, NormalizedPoint]
    | [NormalizedPoint, NormalizedPoint, NormalizedPoint]
    | [NormalizedPoint, NormalizedPoint, NormalizedPoint, NormalizedPoint]
    | [NormalizedPoint, NormalizedPoint, NormalizedPoint, NormalizedPoint, NormalizedPoint]
    | [NormalizedPoint, NormalizedPoint, NormalizedPoint, NormalizedPoint, NormalizedPoint, NormalizedPoint]
    | [
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint
      ]
    | [
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint
      ]
    | [
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint
      ]
    | [
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint
      ]
    | [
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint
      ]
    | [
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint
      ];
  stroke: StrokeStyle;
  arrow?: boolean;
  label?: string;
  meaning?: string;
}
export interface DiagramSmoothPrimitive {
  kind: "smooth";
  /**
   * @minItems 3
   * @maxItems 12
   */
  points:
    | [NormalizedPoint, NormalizedPoint, NormalizedPoint]
    | [NormalizedPoint, NormalizedPoint, NormalizedPoint, NormalizedPoint]
    | [NormalizedPoint, NormalizedPoint, NormalizedPoint, NormalizedPoint, NormalizedPoint]
    | [NormalizedPoint, NormalizedPoint, NormalizedPoint, NormalizedPoint, NormalizedPoint, NormalizedPoint]
    | [
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint
      ]
    | [
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint
      ]
    | [
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint
      ]
    | [
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint
      ]
    | [
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint
      ]
    | [
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint
      ];
  stroke: StrokeStyle;
  arrow?: boolean;
  label?: string;
  meaning?: string;
}
export interface DiagramRectPrimitive {
  kind: "rect";
  from: NormalizedPoint;
  to: NormalizedPoint;
  stroke: StrokeStyle;
  fill?: boolean;
  label?: string;
  meaning?: string;
}
export interface DiagramEllipsePrimitive {
  kind: "ellipse";
  center: NormalizedPoint;
  /**
   * @minItems 2
   * @maxItems 2
   */
  radius: [number, number];
  stroke: StrokeStyle;
  fill?: boolean;
  label?: string;
  meaning?: string;
}
export interface DiagramArcPrimitive {
  kind: "arc";
  center: NormalizedPoint;
  /**
   * @minItems 2
   * @maxItems 2
   */
  radius: [number, number];
  start_deg: number;
  end_deg: number;
  stroke: StrokeStyle;
  arrow?: boolean;
  label?: string;
  meaning?: string;
}
export interface DiagramTextPrimitive {
  kind: "text";
  at: NormalizedPoint;
  content: string;
  align?: "left" | "center" | "right";
  size?: "small" | "normal" | "large";
  meaning?: string;
}
export interface DiagramPointPrimitive {
  kind: "point";
  at: NormalizedPoint;
  label?: string;
  meaning?: string;
}
export interface LineRegionOp {
  op: "line";
  id: ElementId;
  region: Region;
  from: NormalizedPoint;
  to: NormalizedPoint;
  stroke: StrokeStyle;
  label?: string;
  meaning?: string;
}
export interface LineCanvasOp {
  op: "line";
  id: ElementId;
  canvas_id: ElementId;
  from: NormalizedPoint;
  to: NormalizedPoint;
  stroke: StrokeStyle;
  label?: string;
  meaning?: string;
}
export interface LineConstructionOp {
  op: "line";
  id: ElementId;
  construct: LineConstruction;
  stroke: StrokeStyle;
  label?: string;
  meaning?: string;
}
export interface PerpendicularConstruction {
  kind: "perpendicular_through";
  line: ElementId;
  point: GeometryPointReference;
  length: number;
}
export interface TangentConstruction {
  kind: "tangent_at";
  curve: ElementId;
  x: number;
  length: number;
}
export interface ArrowRegionOp {
  op: "arrow";
  id: ElementId;
  region: Region;
  from: NormalizedPoint;
  to: NormalizedPoint;
  stroke: StrokeStyle;
  label?: string;
}
export interface ArrowCanvasOp {
  op: "arrow";
  id: ElementId;
  canvas_id: ElementId;
  from: NormalizedPoint;
  to: NormalizedPoint;
  stroke: StrokeStyle;
  label?: string;
}
export interface PointRegionOp {
  op: "point";
  id: ElementId;
  region: Region;
  at: NormalizedPoint;
  label?: string;
}
export interface PointCanvasOp {
  op: "point";
  id: ElementId;
  canvas_id: ElementId;
  at: NormalizedPoint;
  label?: string;
}
export interface PointConstructionOp {
  op: "point";
  id: ElementId;
  construct: PointConstruction;
  label?: string;
}
export interface AlongConstruction {
  kind: "along";
  element_id: ElementId;
  t: number;
}
export interface MidpointConstruction {
  kind: "midpoint_of";
  a: GeometryPointReference;
  b: GeometryPointReference;
}
export interface IntersectionConstruction {
  kind: "intersection_of";
  a: ElementId;
  b: ElementId;
}
export interface OffsetConstruction {
  kind: "offset_from";
  element_id: ElementId;
  side: "above" | "below" | "left" | "right";
  gap: number;
}
export interface AngleArcRegionOp {
  op: "angle_arc";
  id: ElementId;
  region: Region;
  center: NormalizedPoint;
  radius: number;
  start_deg: number;
  end_deg: number;
  stroke: StrokeStyle;
  label?: string;
}
export interface AngleArcCanvasOp {
  op: "angle_arc";
  id: ElementId;
  canvas_id: ElementId;
  center: NormalizedPoint;
  radius: number;
  start_deg: number;
  end_deg: number;
  stroke: StrokeStyle;
  label?: string;
}
export interface FigureRegionOp {
  op: "figure";
  id: ElementId;
  region: Region;
  frame: FigureFrame;
  /**
   * @minItems 1
   * @maxItems 16
   */
  marks:
    | [FigureMark]
    | [FigureMark, FigureMark]
    | [FigureMark, FigureMark, FigureMark]
    | [FigureMark, FigureMark, FigureMark, FigureMark]
    | [FigureMark, FigureMark, FigureMark, FigureMark, FigureMark]
    | [FigureMark, FigureMark, FigureMark, FigureMark, FigureMark, FigureMark]
    | [FigureMark, FigureMark, FigureMark, FigureMark, FigureMark, FigureMark, FigureMark]
    | [FigureMark, FigureMark, FigureMark, FigureMark, FigureMark, FigureMark, FigureMark, FigureMark]
    | [FigureMark, FigureMark, FigureMark, FigureMark, FigureMark, FigureMark, FigureMark, FigureMark, FigureMark]
    | [
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark
      ]
    | [
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark
      ]
    | [
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark
      ]
    | [
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark
      ]
    | [
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark
      ]
    | [
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark
      ]
    | [
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark
      ];
  meaning?: string;
}
export interface FigureFrame {
  x: FigureRange;
  y: FigureRange;
  axes?: "edge" | "origin" | "none";
  grid?: boolean;
  equal_scale?: boolean;
  x_label?: string;
  y_label?: string;
}
export interface FigurePointMark {
  kind: "point";
  id?: ElementId;
  at: FigurePoint;
  label?: string;
}
export interface FigureSegmentMark {
  kind: "segment";
  id?: ElementId;
  from: FigurePoint;
  to: FigurePoint;
  arrow?: boolean;
  stroke?: StrokeStyle;
  label?: string;
}
export interface FigurePolylineMark {
  kind: "polyline";
  id?: ElementId;
  /**
   * @minItems 2
   * @maxItems 24
   */
  points: [FigurePoint, FigurePoint, ...FigurePoint[]];
  closed?: boolean;
  smooth?: boolean;
  arrow?: boolean;
  fill?: boolean;
  stroke?: StrokeStyle;
  label?: string;
}
export interface FigureCircleMark {
  kind: "circle";
  id?: ElementId;
  center: FigurePoint;
  r: number;
  fill?: boolean;
  stroke?: StrokeStyle;
  label?: string;
}
export interface FigureArcMark {
  kind: "arc";
  id?: ElementId;
  center: FigurePoint;
  r: number;
  start: number;
  end: number;
  arrow?: boolean;
  stroke?: StrokeStyle;
  label?: string;
}
export interface FigureFnMark {
  kind: "fn";
  id?: ElementId;
  y: string;
  domain?: FigureRange;
  stroke?: StrokeStyle;
  label?: string;
}
export interface FigureParamMark {
  kind: "param";
  id?: ElementId;
  x: string;
  y: string;
  t: FigureRange;
  stroke?: StrokeStyle;
  label?: string;
}
export interface FigurePolarMark {
  kind: "polar";
  id?: ElementId;
  r: string;
  theta: FigureRange;
  stroke?: StrokeStyle;
  label?: string;
}
export interface FigureShadeUnderMark {
  kind: "shade";
  id?: ElementId;
  under: ElementId;
  from?: FigureNumber;
  to?: FigureNumber;
  label?: string;
}
export interface FigureShadeBetweenMark {
  kind: "shade";
  id?: ElementId;
  /**
   * @minItems 2
   * @maxItems 2
   */
  between: [ElementId, ElementId];
  from?: FigureNumber;
  to?: FigureNumber;
  label?: string;
}
export interface FigureShadeInsideMark {
  kind: "shade";
  id?: ElementId;
  inside: ElementId;
  /**
   * @minItems 1
   * @maxItems 4
   */
  except?:
    | [ElementId]
    | [ElementId, ElementId]
    | [ElementId, ElementId, ElementId]
    | [ElementId, ElementId, ElementId, ElementId];
  label?: string;
}
export interface FigureAngleMark {
  kind: "angle";
  id?: ElementId;
  at: FigurePoint;
  from: FigurePoint;
  to: FigurePoint;
  r?: number;
  label?: string;
}
export interface FigureTangentMark {
  kind: "tangent";
  id?: ElementId;
  to: ElementId;
  x: FigureNumber;
  length?: number;
  stroke?: StrokeStyle;
  label?: string;
}
export interface FigurePerpendicularMark {
  kind: "perpendicular";
  id?: ElementId;
  to: ElementId;
  through: FigurePoint;
  length?: number;
  stroke?: StrokeStyle;
  label?: string;
}
export interface FigureMeasureMark {
  kind: "measure";
  id?: ElementId;
  from: FigurePoint;
  to: FigurePoint;
  label: string;
}
export interface FigureTextMark {
  kind: "text";
  id?: ElementId;
  at: FigurePoint;
  text: string;
  align?: "left" | "center" | "right";
  size?: "small" | "normal" | "large";
}
export interface FigureGroupMark {
  kind: "group";
  id?: ElementId;
  /**
   * @minItems 1
   * @maxItems 8
   */
  marks:
    | [FigureLeafMark]
    | [FigureLeafMark, FigureLeafMark]
    | [FigureLeafMark, FigureLeafMark, FigureLeafMark]
    | [FigureLeafMark, FigureLeafMark, FigureLeafMark, FigureLeafMark]
    | [FigureLeafMark, FigureLeafMark, FigureLeafMark, FigureLeafMark, FigureLeafMark]
    | [FigureLeafMark, FigureLeafMark, FigureLeafMark, FigureLeafMark, FigureLeafMark, FigureLeafMark]
    | [FigureLeafMark, FigureLeafMark, FigureLeafMark, FigureLeafMark, FigureLeafMark, FigureLeafMark, FigureLeafMark]
    | [
        FigureLeafMark,
        FigureLeafMark,
        FigureLeafMark,
        FigureLeafMark,
        FigureLeafMark,
        FigureLeafMark,
        FigureLeafMark,
        FigureLeafMark
      ];
  mirror?: "x" | "y";
  rotate?: number;
  scale?: number;
  translate?: FigureRange;
  origin?: FigureRange;
  repeat?: number;
}
export interface FigureOnOp {
  op: "figure";
  id: ElementId;
  on: ElementId;
  /**
   * @minItems 1
   * @maxItems 16
   */
  marks:
    | [FigureMark]
    | [FigureMark, FigureMark]
    | [FigureMark, FigureMark, FigureMark]
    | [FigureMark, FigureMark, FigureMark, FigureMark]
    | [FigureMark, FigureMark, FigureMark, FigureMark, FigureMark]
    | [FigureMark, FigureMark, FigureMark, FigureMark, FigureMark, FigureMark]
    | [FigureMark, FigureMark, FigureMark, FigureMark, FigureMark, FigureMark, FigureMark]
    | [FigureMark, FigureMark, FigureMark, FigureMark, FigureMark, FigureMark, FigureMark, FigureMark]
    | [FigureMark, FigureMark, FigureMark, FigureMark, FigureMark, FigureMark, FigureMark, FigureMark, FigureMark]
    | [
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark
      ]
    | [
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark
      ]
    | [
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark
      ]
    | [
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark
      ]
    | [
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark
      ]
    | [
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark
      ]
    | [
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark,
        FigureMark
      ];
  meaning?: string;
}
export interface LayoutPlace {
  kind: "place";
  id: ElementId;
  relative_to: ElementId;
  side: "above" | "below" | "left" | "right";
  align: "start" | "center" | "end";
  gap: number;
}
export interface LayoutAlign {
  kind: "align";
  /**
   * @minItems 2
   * @maxItems 8
   */
  ids:
    | [ElementId, ElementId]
    | [ElementId, ElementId, ElementId]
    | [ElementId, ElementId, ElementId, ElementId]
    | [ElementId, ElementId, ElementId, ElementId, ElementId]
    | [ElementId, ElementId, ElementId, ElementId, ElementId, ElementId]
    | [ElementId, ElementId, ElementId, ElementId, ElementId, ElementId, ElementId]
    | [ElementId, ElementId, ElementId, ElementId, ElementId, ElementId, ElementId, ElementId];
  axis: "horizontal" | "vertical";
  alignment: "start" | "center" | "end";
}
export interface LayoutStack {
  kind: "stack";
  /**
   * @minItems 2
   * @maxItems 8
   */
  ids:
    | [ElementId, ElementId]
    | [ElementId, ElementId, ElementId]
    | [ElementId, ElementId, ElementId, ElementId]
    | [ElementId, ElementId, ElementId, ElementId, ElementId]
    | [ElementId, ElementId, ElementId, ElementId, ElementId, ElementId]
    | [ElementId, ElementId, ElementId, ElementId, ElementId, ElementId, ElementId]
    | [ElementId, ElementId, ElementId, ElementId, ElementId, ElementId, ElementId, ElementId];
  direction: "horizontal" | "vertical";
  align: "start" | "center" | "end";
  gap: number;
}
export interface LayoutDistribute {
  kind: "distribute";
  /**
   * @minItems 3
   * @maxItems 8
   */
  ids:
    | [ElementId, ElementId, ElementId]
    | [ElementId, ElementId, ElementId, ElementId]
    | [ElementId, ElementId, ElementId, ElementId, ElementId]
    | [ElementId, ElementId, ElementId, ElementId, ElementId, ElementId]
    | [ElementId, ElementId, ElementId, ElementId, ElementId, ElementId, ElementId]
    | [ElementId, ElementId, ElementId, ElementId, ElementId, ElementId, ElementId, ElementId];
  direction: "horizontal" | "vertical";
}
export interface Checkpoint {
  question: string;
  expected_gist: string;
}
