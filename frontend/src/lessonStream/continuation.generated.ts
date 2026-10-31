/* Generated from shared/schema/lesson-continuation.schema.json. Do not edit. */

/**
 * Versioned browser-to-FastAPI continuation request and FastAPI-to-browser response contract.
 */
export type LessonContinuationContract = LessonContinuationRequest | LessonContinuationResponse;
export type RequestId = string;
export type LessonOp =
  TextOp | EquationOp | SketchOp | AxesOp | CurveOp | DiagramOp | LineOp | ArrowOp | PointOp | AngleArcOp | FigureOp;
export type TextOp = TextRegionOp | TextAnchorOp;
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
export type LineOp = LineRegionOp | LineCanvasOp | LineConstructionOp;
export type LineConstruction = PerpendicularConstruction | TangentConstruction;
export type GeometryPointReference =
  | {
      kind: "point";
      element_id: string;
    }
  | {
      kind: "endpoint";
      element_id: string;
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
export type FigureRange = [number, number];
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
      at: string;
    }
  | {
      /**
       * @minItems 2
       * @maxItems 2
       */
      mid: [string, string];
    }
  | {
      on: string;
      x: number;
    }
  | {
      on: string;
      t: number;
    }
  | {
      /**
       * @minItems 2
       * @maxItems 2
       */
      hit: [string, string];
    }
  | {
      foot: string;
      onto: string;
    };
export type LayoutRelation = LayoutPlace | LayoutAlign | LayoutStack | LayoutDistribute;
/**
 * Opaque server-authenticated continuation capability. Its payload is not a client API.
 */
export type Receipt = string;
export type LessonContinuationResponse = LessonContinuationSuccess | LessonContinuationTerminal;
export type Model = "gpt-6.1-sol" | "gpt-6-luna" | "gpt-6-astra" | "gpt-5.6-luna" | "gpt-5.6-terra" | "gpt-5.6-sol";
export type ReasoningEffort = "none" | "low";
export type Sha256 = string;
export type TerminalReason =
  | "prefix_mismatch"
  | "invalid_prefix"
  | "invalid_scene"
  | "invalid_receipt"
  | "receipt_replayed"
  | "plan_complete"
  | "not_configured"
  | "continuation_unavailable"
  | "continuation_invalid"
  | "recovery_abandoned";

export interface LessonContinuationRequest {
  request_id: RequestId;
  client_id: RequestId;
  topic: string;
  student_context: string;
  prefix_version: number;
  /**
   * @minItems 1
   * @maxItems 8
   */
  accepted_prefix:
    | [LessonStep]
    | [LessonStep, LessonStep]
    | [LessonStep, LessonStep, LessonStep]
    | [LessonStep, LessonStep, LessonStep, LessonStep]
    | [LessonStep, LessonStep, LessonStep, LessonStep, LessonStep]
    | [LessonStep, LessonStep, LessonStep, LessonStep, LessonStep, LessonStep]
    | [LessonStep, LessonStep, LessonStep, LessonStep, LessonStep, LessonStep, LessonStep]
    | [LessonStep, LessonStep, LessonStep, LessonStep, LessonStep, LessonStep, LessonStep, LessonStep];
  /**
   * Exact server-issued prefix authenticated by the incoming receipt. It may differ from accepted_prefix only by browser-documented dropped steps or ops.
   *
   * @minItems 1
   * @maxItems 8
   */
  receipt_prefix:
    | [LessonStep]
    | [LessonStep, LessonStep]
    | [LessonStep, LessonStep, LessonStep]
    | [LessonStep, LessonStep, LessonStep, LessonStep]
    | [LessonStep, LessonStep, LessonStep, LessonStep, LessonStep]
    | [LessonStep, LessonStep, LessonStep, LessonStep, LessonStep, LessonStep]
    | [LessonStep, LessonStep, LessonStep, LessonStep, LessonStep, LessonStep, LessonStep]
    | [LessonStep, LessonStep, LessonStep, LessonStep, LessonStep, LessonStep, LessonStep, LessonStep];
  plan: LessonPlan;
  resolved_scene: ResolvedBoardScene;
  repairs_used: number;
  continuation_receipt: Receipt;
}
export interface LessonStep {
  id: string;
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
  id: string;
  region: "A1" | "A2" | "A3" | "B1" | "B2" | "B3" | "C1" | "C2" | "C3" | "D1" | "D2" | "D3" | "left" | "right" | "full";
  content: string;
}
export interface TextAnchorOp {
  op: "text";
  id: string;
  anchor: Anchor;
  content: string;
}
export interface Anchor {
  el: string;
  side: "above" | "below" | "left" | "right";
  gap?: number;
}
export interface EquationRegionOp {
  op: "equation";
  id: string;
  region: "A1" | "A2" | "A3" | "B1" | "B2" | "B3" | "C1" | "C2" | "C3" | "D1" | "D2" | "D3" | "left" | "right" | "full";
  latex: string;
}
export interface EquationAnchorOp {
  op: "equation";
  id: string;
  anchor: Anchor;
  latex: string;
}
export interface SketchOp {
  op: "sketch";
  id: string;
  region: "A1" | "A2" | "A3" | "B1" | "B2" | "B3" | "C1" | "C2" | "C3" | "D1" | "D2" | "D3" | "left" | "right" | "full";
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
  id: string;
  region: "A1" | "A2" | "A3" | "B1" | "B2" | "B3" | "C1" | "C2" | "C3" | "D1" | "D2" | "D3" | "left" | "right" | "full";
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
  id: string;
  axes_id: string;
  expr: string;
  /**
   * @minItems 2
   * @maxItems 2
   */
  domain?: [number, number];
}
export interface DiagramOp {
  op: "diagram";
  id: string;
  region: "A1" | "A2" | "A3" | "B1" | "B2" | "B3" | "C1" | "C2" | "C3" | "D1" | "D2" | "D3" | "left" | "right" | "full";
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
  stroke: "solid" | "dashed";
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
  stroke: "solid" | "dashed";
  arrow?: boolean;
  label?: string;
  meaning?: string;
}
export interface DiagramRectPrimitive {
  kind: "rect";
  from: NormalizedPoint;
  to: NormalizedPoint;
  stroke: "solid" | "dashed";
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
  stroke: "solid" | "dashed";
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
  stroke: "solid" | "dashed";
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
  id: string;
  region: "A1" | "A2" | "A3" | "B1" | "B2" | "B3" | "C1" | "C2" | "C3" | "D1" | "D2" | "D3" | "left" | "right" | "full";
  from: NormalizedPoint;
  to: NormalizedPoint;
  stroke: "solid" | "dashed";
  label?: string;
  meaning?: string;
}
export interface LineCanvasOp {
  op: "line";
  id: string;
  canvas_id: string;
  from: NormalizedPoint;
  to: NormalizedPoint;
  stroke: "solid" | "dashed";
  label?: string;
  meaning?: string;
}
export interface LineConstructionOp {
  op: "line";
  id: string;
  construct: LineConstruction;
  stroke: "solid" | "dashed";
  label?: string;
  meaning?: string;
}
export interface PerpendicularConstruction {
  kind: "perpendicular_through";
  line: string;
  point: GeometryPointReference;
  length: number;
}
export interface TangentConstruction {
  kind: "tangent_at";
  curve: string;
  x: number;
  length: number;
}
export interface ArrowRegionOp {
  op: "arrow";
  id: string;
  region: "A1" | "A2" | "A3" | "B1" | "B2" | "B3" | "C1" | "C2" | "C3" | "D1" | "D2" | "D3" | "left" | "right" | "full";
  from: NormalizedPoint;
  to: NormalizedPoint;
  stroke: "solid" | "dashed";
  label?: string;
}
export interface ArrowCanvasOp {
  op: "arrow";
  id: string;
  canvas_id: string;
  from: NormalizedPoint;
  to: NormalizedPoint;
  stroke: "solid" | "dashed";
  label?: string;
}
export interface PointRegionOp {
  op: "point";
  id: string;
  region: "A1" | "A2" | "A3" | "B1" | "B2" | "B3" | "C1" | "C2" | "C3" | "D1" | "D2" | "D3" | "left" | "right" | "full";
  at: NormalizedPoint;
  label?: string;
}
export interface PointCanvasOp {
  op: "point";
  id: string;
  canvas_id: string;
  at: NormalizedPoint;
  label?: string;
}
export interface PointConstructionOp {
  op: "point";
  id: string;
  construct: PointConstruction;
  label?: string;
}
export interface AlongConstruction {
  kind: "along";
  element_id: string;
  t: number;
}
export interface MidpointConstruction {
  kind: "midpoint_of";
  a: GeometryPointReference;
  b: GeometryPointReference;
}
export interface IntersectionConstruction {
  kind: "intersection_of";
  a: string;
  b: string;
}
export interface OffsetConstruction {
  kind: "offset_from";
  element_id: string;
  side: "above" | "below" | "left" | "right";
  gap: number;
}
export interface AngleArcRegionOp {
  op: "angle_arc";
  id: string;
  region: "A1" | "A2" | "A3" | "B1" | "B2" | "B3" | "C1" | "C2" | "C3" | "D1" | "D2" | "D3" | "left" | "right" | "full";
  center: NormalizedPoint;
  radius: number;
  start_deg: number;
  end_deg: number;
  stroke: "solid" | "dashed";
  label?: string;
}
export interface AngleArcCanvasOp {
  op: "angle_arc";
  id: string;
  canvas_id: string;
  center: NormalizedPoint;
  radius: number;
  start_deg: number;
  end_deg: number;
  stroke: "solid" | "dashed";
  label?: string;
}
export interface FigureRegionOp {
  op: "figure";
  id: string;
  region: "A1" | "A2" | "A3" | "B1" | "B2" | "B3" | "C1" | "C2" | "C3" | "D1" | "D2" | "D3" | "left" | "right" | "full";
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
  id?: string;
  at: FigurePoint;
  label?: string;
}
export interface FigureSegmentMark {
  kind: "segment";
  id?: string;
  from: FigurePoint;
  to: FigurePoint;
  arrow?: boolean;
  stroke?: "solid" | "dashed";
  label?: string;
}
export interface FigurePolylineMark {
  kind: "polyline";
  id?: string;
  /**
   * @minItems 2
   * @maxItems 24
   */
  points: [FigurePoint, FigurePoint, ...FigurePoint[]];
  closed?: boolean;
  smooth?: boolean;
  arrow?: boolean;
  fill?: boolean;
  stroke?: "solid" | "dashed";
  label?: string;
}
export interface FigureCircleMark {
  kind: "circle";
  id?: string;
  center: FigurePoint;
  r: number;
  fill?: boolean;
  stroke?: "solid" | "dashed";
  label?: string;
}
export interface FigureArcMark {
  kind: "arc";
  id?: string;
  center: FigurePoint;
  r: number;
  start: number;
  end: number;
  arrow?: boolean;
  stroke?: "solid" | "dashed";
  label?: string;
}
export interface FigureFnMark {
  kind: "fn";
  id?: string;
  y: string;
  domain?: FigureRange;
  stroke?: "solid" | "dashed";
  label?: string;
}
export interface FigureParamMark {
  kind: "param";
  id?: string;
  x: string;
  y: string;
  t: FigureRange;
  stroke?: "solid" | "dashed";
  label?: string;
}
export interface FigurePolarMark {
  kind: "polar";
  id?: string;
  r: string;
  theta: FigureRange;
  stroke?: "solid" | "dashed";
  label?: string;
}
export interface FigureShadeUnderMark {
  kind: "shade";
  id?: string;
  under: string;
  from?: number;
  to?: number;
  label?: string;
}
export interface FigureShadeBetweenMark {
  kind: "shade";
  id?: string;
  /**
   * @minItems 2
   * @maxItems 2
   */
  between: [string, string];
  from?: number;
  to?: number;
  label?: string;
}
export interface FigureShadeInsideMark {
  kind: "shade";
  id?: string;
  inside: string;
  /**
   * @minItems 1
   * @maxItems 4
   */
  except?: [string] | [string, string] | [string, string, string] | [string, string, string, string];
  label?: string;
}
export interface FigureAngleMark {
  kind: "angle";
  id?: string;
  at: FigurePoint;
  from: FigurePoint;
  to: FigurePoint;
  r?: number;
  label?: string;
}
export interface FigureTangentMark {
  kind: "tangent";
  id?: string;
  to: string;
  x: number;
  length?: number;
  stroke?: "solid" | "dashed";
  label?: string;
}
export interface FigurePerpendicularMark {
  kind: "perpendicular";
  id?: string;
  to: string;
  through: FigurePoint;
  length?: number;
  stroke?: "solid" | "dashed";
  label?: string;
}
export interface FigureMeasureMark {
  kind: "measure";
  id?: string;
  from: FigurePoint;
  to: FigurePoint;
  label: string;
}
export interface FigureTextMark {
  kind: "text";
  id?: string;
  at: FigurePoint;
  text: string;
  align?: "left" | "center" | "right";
  size?: "small" | "normal" | "large";
}
export interface FigureGroupMark {
  kind: "group";
  id?: string;
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
  id: string;
  on: string;
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
  id: string;
  relative_to: string;
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
    | [string, string]
    | [string, string, string]
    | [string, string, string, string]
    | [string, string, string, string, string]
    | [string, string, string, string, string, string]
    | [string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string];
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
    | [string, string]
    | [string, string, string]
    | [string, string, string, string]
    | [string, string, string, string, string]
    | [string, string, string, string, string, string]
    | [string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string];
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
    | [string, string, string]
    | [string, string, string, string]
    | [string, string, string, string, string]
    | [string, string, string, string, string, string]
    | [string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string];
  direction: "horizontal" | "vertical";
}
export interface Checkpoint {
  question: string;
  expected_gist: string;
}
export interface LessonPlan {
  kind: "lesson_plan";
  visual_structure: string;
  composition_archetype?:
    | "single_large_figure"
    | "derivation_plus_diagram"
    | "worked_example_column"
    | "comparison_pair"
    | "graph_with_summary";
  /**
   * @minItems 3
   * @maxItems 5
   */
  progression: [string, string, string] | [string, string, string, string] | [string, string, string, string, string];
  checkpoint_step: number | null;
}
export interface ResolvedBoardScene {
  schema_version: "1.0";
  request_id: string;
  prefix_version: number;
  /**
   * @maxItems 30
   */
  elements: {
    id: string;
    kind: "text" | "equation" | "axes" | "curve" | "sketch" | "line" | "arrow" | "point" | "angle_arc" | "diagram";
    /**
     * @minItems 4
     * @maxItems 4
     */
    bounds: [number, number, number, number];
    summary: string;
    state: "committed" | "buffered";
  }[];
  /**
   * @maxItems 12
   */
  findings:
    | []
    | [
        | {
            code:
              | "label_overlap"
              | "label_out_of_bounds"
              | "text_overflow"
              | "element_overlap"
              | "reading_order_conflict"
              | "measurement_unavailable";
            evidence: "estimated" | "measured" | "semantic";
            /**
             * @minItems 1
             * @maxItems 4
             */
            element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
          }
        | {
            code: "region_crowded" | "board_imbalanced";
            evidence: "estimated" | "measured" | "semantic";
            /**
             * @minItems 1
             * @maxItems 4
             */
            element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
            zone:
              | "A1"
              | "A2"
              | "A3"
              | "B1"
              | "B2"
              | "B3"
              | "C1"
              | "C2"
              | "C3"
              | "D1"
              | "D2"
              | "D3"
              | "left"
              | "right"
              | "full";
          }
        | {
            code: "region_sparse";
            evidence: "estimated" | "measured" | "semantic";
            /**
             * @maxItems 4
             */
            element_ids: [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
            zone:
              | "A1"
              | "A2"
              | "A3"
              | "B1"
              | "B2"
              | "B3"
              | "C1"
              | "C2"
              | "C3"
              | "D1"
              | "D2"
              | "D3"
              | "left"
              | "right"
              | "full";
          }
      ]
    | [
        (
          | {
              code:
                | "label_overlap"
                | "label_out_of_bounds"
                | "text_overflow"
                | "element_overlap"
                | "reading_order_conflict"
                | "measurement_unavailable";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
            }
          | {
              code: "region_crowded" | "board_imbalanced";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
          | {
              code: "region_sparse";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @maxItems 4
               */
              element_ids:
                [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
        ),
        (
          | {
              code:
                | "label_overlap"
                | "label_out_of_bounds"
                | "text_overflow"
                | "element_overlap"
                | "reading_order_conflict"
                | "measurement_unavailable";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
            }
          | {
              code: "region_crowded" | "board_imbalanced";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
          | {
              code: "region_sparse";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @maxItems 4
               */
              element_ids:
                [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
        )
      ]
    | [
        (
          | {
              code:
                | "label_overlap"
                | "label_out_of_bounds"
                | "text_overflow"
                | "element_overlap"
                | "reading_order_conflict"
                | "measurement_unavailable";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
            }
          | {
              code: "region_crowded" | "board_imbalanced";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
          | {
              code: "region_sparse";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @maxItems 4
               */
              element_ids:
                [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
        ),
        (
          | {
              code:
                | "label_overlap"
                | "label_out_of_bounds"
                | "text_overflow"
                | "element_overlap"
                | "reading_order_conflict"
                | "measurement_unavailable";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
            }
          | {
              code: "region_crowded" | "board_imbalanced";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
          | {
              code: "region_sparse";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @maxItems 4
               */
              element_ids:
                [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
        ),
        (
          | {
              code:
                | "label_overlap"
                | "label_out_of_bounds"
                | "text_overflow"
                | "element_overlap"
                | "reading_order_conflict"
                | "measurement_unavailable";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
            }
          | {
              code: "region_crowded" | "board_imbalanced";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
          | {
              code: "region_sparse";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @maxItems 4
               */
              element_ids:
                [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
        )
      ]
    | [
        (
          | {
              code:
                | "label_overlap"
                | "label_out_of_bounds"
                | "text_overflow"
                | "element_overlap"
                | "reading_order_conflict"
                | "measurement_unavailable";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
            }
          | {
              code: "region_crowded" | "board_imbalanced";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
          | {
              code: "region_sparse";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @maxItems 4
               */
              element_ids:
                [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
        ),
        (
          | {
              code:
                | "label_overlap"
                | "label_out_of_bounds"
                | "text_overflow"
                | "element_overlap"
                | "reading_order_conflict"
                | "measurement_unavailable";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
            }
          | {
              code: "region_crowded" | "board_imbalanced";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
          | {
              code: "region_sparse";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @maxItems 4
               */
              element_ids:
                [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
        ),
        (
          | {
              code:
                | "label_overlap"
                | "label_out_of_bounds"
                | "text_overflow"
                | "element_overlap"
                | "reading_order_conflict"
                | "measurement_unavailable";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
            }
          | {
              code: "region_crowded" | "board_imbalanced";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
          | {
              code: "region_sparse";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @maxItems 4
               */
              element_ids:
                [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
        ),
        (
          | {
              code:
                | "label_overlap"
                | "label_out_of_bounds"
                | "text_overflow"
                | "element_overlap"
                | "reading_order_conflict"
                | "measurement_unavailable";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
            }
          | {
              code: "region_crowded" | "board_imbalanced";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
          | {
              code: "region_sparse";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @maxItems 4
               */
              element_ids:
                [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
        )
      ]
    | [
        (
          | {
              code:
                | "label_overlap"
                | "label_out_of_bounds"
                | "text_overflow"
                | "element_overlap"
                | "reading_order_conflict"
                | "measurement_unavailable";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
            }
          | {
              code: "region_crowded" | "board_imbalanced";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
          | {
              code: "region_sparse";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @maxItems 4
               */
              element_ids:
                [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
        ),
        (
          | {
              code:
                | "label_overlap"
                | "label_out_of_bounds"
                | "text_overflow"
                | "element_overlap"
                | "reading_order_conflict"
                | "measurement_unavailable";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
            }
          | {
              code: "region_crowded" | "board_imbalanced";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
          | {
              code: "region_sparse";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @maxItems 4
               */
              element_ids:
                [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
        ),
        (
          | {
              code:
                | "label_overlap"
                | "label_out_of_bounds"
                | "text_overflow"
                | "element_overlap"
                | "reading_order_conflict"
                | "measurement_unavailable";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
            }
          | {
              code: "region_crowded" | "board_imbalanced";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
          | {
              code: "region_sparse";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @maxItems 4
               */
              element_ids:
                [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
        ),
        (
          | {
              code:
                | "label_overlap"
                | "label_out_of_bounds"
                | "text_overflow"
                | "element_overlap"
                | "reading_order_conflict"
                | "measurement_unavailable";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
            }
          | {
              code: "region_crowded" | "board_imbalanced";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
          | {
              code: "region_sparse";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @maxItems 4
               */
              element_ids:
                [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
        ),
        (
          | {
              code:
                | "label_overlap"
                | "label_out_of_bounds"
                | "text_overflow"
                | "element_overlap"
                | "reading_order_conflict"
                | "measurement_unavailable";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
            }
          | {
              code: "region_crowded" | "board_imbalanced";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
          | {
              code: "region_sparse";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @maxItems 4
               */
              element_ids:
                [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
        )
      ]
    | [
        (
          | {
              code:
                | "label_overlap"
                | "label_out_of_bounds"
                | "text_overflow"
                | "element_overlap"
                | "reading_order_conflict"
                | "measurement_unavailable";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
            }
          | {
              code: "region_crowded" | "board_imbalanced";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
          | {
              code: "region_sparse";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @maxItems 4
               */
              element_ids:
                [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
        ),
        (
          | {
              code:
                | "label_overlap"
                | "label_out_of_bounds"
                | "text_overflow"
                | "element_overlap"
                | "reading_order_conflict"
                | "measurement_unavailable";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
            }
          | {
              code: "region_crowded" | "board_imbalanced";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
          | {
              code: "region_sparse";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @maxItems 4
               */
              element_ids:
                [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
        ),
        (
          | {
              code:
                | "label_overlap"
                | "label_out_of_bounds"
                | "text_overflow"
                | "element_overlap"
                | "reading_order_conflict"
                | "measurement_unavailable";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
            }
          | {
              code: "region_crowded" | "board_imbalanced";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
          | {
              code: "region_sparse";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @maxItems 4
               */
              element_ids:
                [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
        ),
        (
          | {
              code:
                | "label_overlap"
                | "label_out_of_bounds"
                | "text_overflow"
                | "element_overlap"
                | "reading_order_conflict"
                | "measurement_unavailable";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
            }
          | {
              code: "region_crowded" | "board_imbalanced";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
          | {
              code: "region_sparse";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @maxItems 4
               */
              element_ids:
                [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
        ),
        (
          | {
              code:
                | "label_overlap"
                | "label_out_of_bounds"
                | "text_overflow"
                | "element_overlap"
                | "reading_order_conflict"
                | "measurement_unavailable";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
            }
          | {
              code: "region_crowded" | "board_imbalanced";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
          | {
              code: "region_sparse";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @maxItems 4
               */
              element_ids:
                [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
        ),
        (
          | {
              code:
                | "label_overlap"
                | "label_out_of_bounds"
                | "text_overflow"
                | "element_overlap"
                | "reading_order_conflict"
                | "measurement_unavailable";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
            }
          | {
              code: "region_crowded" | "board_imbalanced";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
          | {
              code: "region_sparse";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @maxItems 4
               */
              element_ids:
                [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
        )
      ]
    | [
        (
          | {
              code:
                | "label_overlap"
                | "label_out_of_bounds"
                | "text_overflow"
                | "element_overlap"
                | "reading_order_conflict"
                | "measurement_unavailable";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
            }
          | {
              code: "region_crowded" | "board_imbalanced";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
          | {
              code: "region_sparse";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @maxItems 4
               */
              element_ids:
                [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
        ),
        (
          | {
              code:
                | "label_overlap"
                | "label_out_of_bounds"
                | "text_overflow"
                | "element_overlap"
                | "reading_order_conflict"
                | "measurement_unavailable";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
            }
          | {
              code: "region_crowded" | "board_imbalanced";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
          | {
              code: "region_sparse";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @maxItems 4
               */
              element_ids:
                [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
        ),
        (
          | {
              code:
                | "label_overlap"
                | "label_out_of_bounds"
                | "text_overflow"
                | "element_overlap"
                | "reading_order_conflict"
                | "measurement_unavailable";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
            }
          | {
              code: "region_crowded" | "board_imbalanced";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
          | {
              code: "region_sparse";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @maxItems 4
               */
              element_ids:
                [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
        ),
        (
          | {
              code:
                | "label_overlap"
                | "label_out_of_bounds"
                | "text_overflow"
                | "element_overlap"
                | "reading_order_conflict"
                | "measurement_unavailable";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
            }
          | {
              code: "region_crowded" | "board_imbalanced";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
          | {
              code: "region_sparse";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @maxItems 4
               */
              element_ids:
                [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
        ),
        (
          | {
              code:
                | "label_overlap"
                | "label_out_of_bounds"
                | "text_overflow"
                | "element_overlap"
                | "reading_order_conflict"
                | "measurement_unavailable";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
            }
          | {
              code: "region_crowded" | "board_imbalanced";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
          | {
              code: "region_sparse";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @maxItems 4
               */
              element_ids:
                [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
        ),
        (
          | {
              code:
                | "label_overlap"
                | "label_out_of_bounds"
                | "text_overflow"
                | "element_overlap"
                | "reading_order_conflict"
                | "measurement_unavailable";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
            }
          | {
              code: "region_crowded" | "board_imbalanced";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
          | {
              code: "region_sparse";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @maxItems 4
               */
              element_ids:
                [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
        ),
        (
          | {
              code:
                | "label_overlap"
                | "label_out_of_bounds"
                | "text_overflow"
                | "element_overlap"
                | "reading_order_conflict"
                | "measurement_unavailable";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
            }
          | {
              code: "region_crowded" | "board_imbalanced";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
          | {
              code: "region_sparse";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @maxItems 4
               */
              element_ids:
                [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
        )
      ]
    | [
        (
          | {
              code:
                | "label_overlap"
                | "label_out_of_bounds"
                | "text_overflow"
                | "element_overlap"
                | "reading_order_conflict"
                | "measurement_unavailable";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
            }
          | {
              code: "region_crowded" | "board_imbalanced";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
          | {
              code: "region_sparse";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @maxItems 4
               */
              element_ids:
                [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
        ),
        (
          | {
              code:
                | "label_overlap"
                | "label_out_of_bounds"
                | "text_overflow"
                | "element_overlap"
                | "reading_order_conflict"
                | "measurement_unavailable";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
            }
          | {
              code: "region_crowded" | "board_imbalanced";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
          | {
              code: "region_sparse";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @maxItems 4
               */
              element_ids:
                [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
        ),
        (
          | {
              code:
                | "label_overlap"
                | "label_out_of_bounds"
                | "text_overflow"
                | "element_overlap"
                | "reading_order_conflict"
                | "measurement_unavailable";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
            }
          | {
              code: "region_crowded" | "board_imbalanced";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
          | {
              code: "region_sparse";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @maxItems 4
               */
              element_ids:
                [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
        ),
        (
          | {
              code:
                | "label_overlap"
                | "label_out_of_bounds"
                | "text_overflow"
                | "element_overlap"
                | "reading_order_conflict"
                | "measurement_unavailable";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
            }
          | {
              code: "region_crowded" | "board_imbalanced";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
          | {
              code: "region_sparse";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @maxItems 4
               */
              element_ids:
                [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
        ),
        (
          | {
              code:
                | "label_overlap"
                | "label_out_of_bounds"
                | "text_overflow"
                | "element_overlap"
                | "reading_order_conflict"
                | "measurement_unavailable";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
            }
          | {
              code: "region_crowded" | "board_imbalanced";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
          | {
              code: "region_sparse";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @maxItems 4
               */
              element_ids:
                [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
        ),
        (
          | {
              code:
                | "label_overlap"
                | "label_out_of_bounds"
                | "text_overflow"
                | "element_overlap"
                | "reading_order_conflict"
                | "measurement_unavailable";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
            }
          | {
              code: "region_crowded" | "board_imbalanced";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
          | {
              code: "region_sparse";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @maxItems 4
               */
              element_ids:
                [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
        ),
        (
          | {
              code:
                | "label_overlap"
                | "label_out_of_bounds"
                | "text_overflow"
                | "element_overlap"
                | "reading_order_conflict"
                | "measurement_unavailable";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
            }
          | {
              code: "region_crowded" | "board_imbalanced";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
          | {
              code: "region_sparse";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @maxItems 4
               */
              element_ids:
                [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
        ),
        (
          | {
              code:
                | "label_overlap"
                | "label_out_of_bounds"
                | "text_overflow"
                | "element_overlap"
                | "reading_order_conflict"
                | "measurement_unavailable";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
            }
          | {
              code: "region_crowded" | "board_imbalanced";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
          | {
              code: "region_sparse";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @maxItems 4
               */
              element_ids:
                [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
        )
      ]
    | [
        (
          | {
              code:
                | "label_overlap"
                | "label_out_of_bounds"
                | "text_overflow"
                | "element_overlap"
                | "reading_order_conflict"
                | "measurement_unavailable";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
            }
          | {
              code: "region_crowded" | "board_imbalanced";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
          | {
              code: "region_sparse";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @maxItems 4
               */
              element_ids:
                [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
        ),
        (
          | {
              code:
                | "label_overlap"
                | "label_out_of_bounds"
                | "text_overflow"
                | "element_overlap"
                | "reading_order_conflict"
                | "measurement_unavailable";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
            }
          | {
              code: "region_crowded" | "board_imbalanced";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
          | {
              code: "region_sparse";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @maxItems 4
               */
              element_ids:
                [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
        ),
        (
          | {
              code:
                | "label_overlap"
                | "label_out_of_bounds"
                | "text_overflow"
                | "element_overlap"
                | "reading_order_conflict"
                | "measurement_unavailable";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
            }
          | {
              code: "region_crowded" | "board_imbalanced";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
          | {
              code: "region_sparse";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @maxItems 4
               */
              element_ids:
                [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
        ),
        (
          | {
              code:
                | "label_overlap"
                | "label_out_of_bounds"
                | "text_overflow"
                | "element_overlap"
                | "reading_order_conflict"
                | "measurement_unavailable";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
            }
          | {
              code: "region_crowded" | "board_imbalanced";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
          | {
              code: "region_sparse";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @maxItems 4
               */
              element_ids:
                [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
        ),
        (
          | {
              code:
                | "label_overlap"
                | "label_out_of_bounds"
                | "text_overflow"
                | "element_overlap"
                | "reading_order_conflict"
                | "measurement_unavailable";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
            }
          | {
              code: "region_crowded" | "board_imbalanced";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
          | {
              code: "region_sparse";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @maxItems 4
               */
              element_ids:
                [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
        ),
        (
          | {
              code:
                | "label_overlap"
                | "label_out_of_bounds"
                | "text_overflow"
                | "element_overlap"
                | "reading_order_conflict"
                | "measurement_unavailable";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
            }
          | {
              code: "region_crowded" | "board_imbalanced";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
          | {
              code: "region_sparse";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @maxItems 4
               */
              element_ids:
                [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
        ),
        (
          | {
              code:
                | "label_overlap"
                | "label_out_of_bounds"
                | "text_overflow"
                | "element_overlap"
                | "reading_order_conflict"
                | "measurement_unavailable";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
            }
          | {
              code: "region_crowded" | "board_imbalanced";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
          | {
              code: "region_sparse";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @maxItems 4
               */
              element_ids:
                [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
        ),
        (
          | {
              code:
                | "label_overlap"
                | "label_out_of_bounds"
                | "text_overflow"
                | "element_overlap"
                | "reading_order_conflict"
                | "measurement_unavailable";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
            }
          | {
              code: "region_crowded" | "board_imbalanced";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
          | {
              code: "region_sparse";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @maxItems 4
               */
              element_ids:
                [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
        ),
        (
          | {
              code:
                | "label_overlap"
                | "label_out_of_bounds"
                | "text_overflow"
                | "element_overlap"
                | "reading_order_conflict"
                | "measurement_unavailable";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
            }
          | {
              code: "region_crowded" | "board_imbalanced";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
          | {
              code: "region_sparse";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @maxItems 4
               */
              element_ids:
                [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
        )
      ]
    | [
        (
          | {
              code:
                | "label_overlap"
                | "label_out_of_bounds"
                | "text_overflow"
                | "element_overlap"
                | "reading_order_conflict"
                | "measurement_unavailable";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
            }
          | {
              code: "region_crowded" | "board_imbalanced";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
          | {
              code: "region_sparse";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @maxItems 4
               */
              element_ids:
                [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
        ),
        (
          | {
              code:
                | "label_overlap"
                | "label_out_of_bounds"
                | "text_overflow"
                | "element_overlap"
                | "reading_order_conflict"
                | "measurement_unavailable";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
            }
          | {
              code: "region_crowded" | "board_imbalanced";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
          | {
              code: "region_sparse";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @maxItems 4
               */
              element_ids:
                [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
        ),
        (
          | {
              code:
                | "label_overlap"
                | "label_out_of_bounds"
                | "text_overflow"
                | "element_overlap"
                | "reading_order_conflict"
                | "measurement_unavailable";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
            }
          | {
              code: "region_crowded" | "board_imbalanced";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
          | {
              code: "region_sparse";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @maxItems 4
               */
              element_ids:
                [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
        ),
        (
          | {
              code:
                | "label_overlap"
                | "label_out_of_bounds"
                | "text_overflow"
                | "element_overlap"
                | "reading_order_conflict"
                | "measurement_unavailable";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
            }
          | {
              code: "region_crowded" | "board_imbalanced";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
          | {
              code: "region_sparse";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @maxItems 4
               */
              element_ids:
                [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
        ),
        (
          | {
              code:
                | "label_overlap"
                | "label_out_of_bounds"
                | "text_overflow"
                | "element_overlap"
                | "reading_order_conflict"
                | "measurement_unavailable";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
            }
          | {
              code: "region_crowded" | "board_imbalanced";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
          | {
              code: "region_sparse";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @maxItems 4
               */
              element_ids:
                [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
        ),
        (
          | {
              code:
                | "label_overlap"
                | "label_out_of_bounds"
                | "text_overflow"
                | "element_overlap"
                | "reading_order_conflict"
                | "measurement_unavailable";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
            }
          | {
              code: "region_crowded" | "board_imbalanced";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
          | {
              code: "region_sparse";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @maxItems 4
               */
              element_ids:
                [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
        ),
        (
          | {
              code:
                | "label_overlap"
                | "label_out_of_bounds"
                | "text_overflow"
                | "element_overlap"
                | "reading_order_conflict"
                | "measurement_unavailable";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
            }
          | {
              code: "region_crowded" | "board_imbalanced";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
          | {
              code: "region_sparse";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @maxItems 4
               */
              element_ids:
                [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
        ),
        (
          | {
              code:
                | "label_overlap"
                | "label_out_of_bounds"
                | "text_overflow"
                | "element_overlap"
                | "reading_order_conflict"
                | "measurement_unavailable";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
            }
          | {
              code: "region_crowded" | "board_imbalanced";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
          | {
              code: "region_sparse";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @maxItems 4
               */
              element_ids:
                [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
        ),
        (
          | {
              code:
                | "label_overlap"
                | "label_out_of_bounds"
                | "text_overflow"
                | "element_overlap"
                | "reading_order_conflict"
                | "measurement_unavailable";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
            }
          | {
              code: "region_crowded" | "board_imbalanced";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
          | {
              code: "region_sparse";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @maxItems 4
               */
              element_ids:
                [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
        ),
        (
          | {
              code:
                | "label_overlap"
                | "label_out_of_bounds"
                | "text_overflow"
                | "element_overlap"
                | "reading_order_conflict"
                | "measurement_unavailable";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
            }
          | {
              code: "region_crowded" | "board_imbalanced";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
          | {
              code: "region_sparse";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @maxItems 4
               */
              element_ids:
                [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
        )
      ]
    | [
        (
          | {
              code:
                | "label_overlap"
                | "label_out_of_bounds"
                | "text_overflow"
                | "element_overlap"
                | "reading_order_conflict"
                | "measurement_unavailable";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
            }
          | {
              code: "region_crowded" | "board_imbalanced";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
          | {
              code: "region_sparse";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @maxItems 4
               */
              element_ids:
                [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
        ),
        (
          | {
              code:
                | "label_overlap"
                | "label_out_of_bounds"
                | "text_overflow"
                | "element_overlap"
                | "reading_order_conflict"
                | "measurement_unavailable";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
            }
          | {
              code: "region_crowded" | "board_imbalanced";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
          | {
              code: "region_sparse";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @maxItems 4
               */
              element_ids:
                [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
        ),
        (
          | {
              code:
                | "label_overlap"
                | "label_out_of_bounds"
                | "text_overflow"
                | "element_overlap"
                | "reading_order_conflict"
                | "measurement_unavailable";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
            }
          | {
              code: "region_crowded" | "board_imbalanced";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
          | {
              code: "region_sparse";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @maxItems 4
               */
              element_ids:
                [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
        ),
        (
          | {
              code:
                | "label_overlap"
                | "label_out_of_bounds"
                | "text_overflow"
                | "element_overlap"
                | "reading_order_conflict"
                | "measurement_unavailable";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
            }
          | {
              code: "region_crowded" | "board_imbalanced";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
          | {
              code: "region_sparse";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @maxItems 4
               */
              element_ids:
                [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
        ),
        (
          | {
              code:
                | "label_overlap"
                | "label_out_of_bounds"
                | "text_overflow"
                | "element_overlap"
                | "reading_order_conflict"
                | "measurement_unavailable";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
            }
          | {
              code: "region_crowded" | "board_imbalanced";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
          | {
              code: "region_sparse";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @maxItems 4
               */
              element_ids:
                [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
        ),
        (
          | {
              code:
                | "label_overlap"
                | "label_out_of_bounds"
                | "text_overflow"
                | "element_overlap"
                | "reading_order_conflict"
                | "measurement_unavailable";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
            }
          | {
              code: "region_crowded" | "board_imbalanced";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
          | {
              code: "region_sparse";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @maxItems 4
               */
              element_ids:
                [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
        ),
        (
          | {
              code:
                | "label_overlap"
                | "label_out_of_bounds"
                | "text_overflow"
                | "element_overlap"
                | "reading_order_conflict"
                | "measurement_unavailable";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
            }
          | {
              code: "region_crowded" | "board_imbalanced";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
          | {
              code: "region_sparse";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @maxItems 4
               */
              element_ids:
                [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
        ),
        (
          | {
              code:
                | "label_overlap"
                | "label_out_of_bounds"
                | "text_overflow"
                | "element_overlap"
                | "reading_order_conflict"
                | "measurement_unavailable";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
            }
          | {
              code: "region_crowded" | "board_imbalanced";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
          | {
              code: "region_sparse";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @maxItems 4
               */
              element_ids:
                [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
        ),
        (
          | {
              code:
                | "label_overlap"
                | "label_out_of_bounds"
                | "text_overflow"
                | "element_overlap"
                | "reading_order_conflict"
                | "measurement_unavailable";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
            }
          | {
              code: "region_crowded" | "board_imbalanced";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
          | {
              code: "region_sparse";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @maxItems 4
               */
              element_ids:
                [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
        ),
        (
          | {
              code:
                | "label_overlap"
                | "label_out_of_bounds"
                | "text_overflow"
                | "element_overlap"
                | "reading_order_conflict"
                | "measurement_unavailable";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
            }
          | {
              code: "region_crowded" | "board_imbalanced";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
          | {
              code: "region_sparse";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @maxItems 4
               */
              element_ids:
                [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
        ),
        (
          | {
              code:
                | "label_overlap"
                | "label_out_of_bounds"
                | "text_overflow"
                | "element_overlap"
                | "reading_order_conflict"
                | "measurement_unavailable";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
            }
          | {
              code: "region_crowded" | "board_imbalanced";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
          | {
              code: "region_sparse";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @maxItems 4
               */
              element_ids:
                [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
        )
      ]
    | [
        (
          | {
              code:
                | "label_overlap"
                | "label_out_of_bounds"
                | "text_overflow"
                | "element_overlap"
                | "reading_order_conflict"
                | "measurement_unavailable";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
            }
          | {
              code: "region_crowded" | "board_imbalanced";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
          | {
              code: "region_sparse";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @maxItems 4
               */
              element_ids:
                [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
        ),
        (
          | {
              code:
                | "label_overlap"
                | "label_out_of_bounds"
                | "text_overflow"
                | "element_overlap"
                | "reading_order_conflict"
                | "measurement_unavailable";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
            }
          | {
              code: "region_crowded" | "board_imbalanced";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
          | {
              code: "region_sparse";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @maxItems 4
               */
              element_ids:
                [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
        ),
        (
          | {
              code:
                | "label_overlap"
                | "label_out_of_bounds"
                | "text_overflow"
                | "element_overlap"
                | "reading_order_conflict"
                | "measurement_unavailable";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
            }
          | {
              code: "region_crowded" | "board_imbalanced";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
          | {
              code: "region_sparse";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @maxItems 4
               */
              element_ids:
                [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
        ),
        (
          | {
              code:
                | "label_overlap"
                | "label_out_of_bounds"
                | "text_overflow"
                | "element_overlap"
                | "reading_order_conflict"
                | "measurement_unavailable";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
            }
          | {
              code: "region_crowded" | "board_imbalanced";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
          | {
              code: "region_sparse";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @maxItems 4
               */
              element_ids:
                [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
        ),
        (
          | {
              code:
                | "label_overlap"
                | "label_out_of_bounds"
                | "text_overflow"
                | "element_overlap"
                | "reading_order_conflict"
                | "measurement_unavailable";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
            }
          | {
              code: "region_crowded" | "board_imbalanced";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
          | {
              code: "region_sparse";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @maxItems 4
               */
              element_ids:
                [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
        ),
        (
          | {
              code:
                | "label_overlap"
                | "label_out_of_bounds"
                | "text_overflow"
                | "element_overlap"
                | "reading_order_conflict"
                | "measurement_unavailable";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
            }
          | {
              code: "region_crowded" | "board_imbalanced";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
          | {
              code: "region_sparse";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @maxItems 4
               */
              element_ids:
                [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
        ),
        (
          | {
              code:
                | "label_overlap"
                | "label_out_of_bounds"
                | "text_overflow"
                | "element_overlap"
                | "reading_order_conflict"
                | "measurement_unavailable";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
            }
          | {
              code: "region_crowded" | "board_imbalanced";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
          | {
              code: "region_sparse";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @maxItems 4
               */
              element_ids:
                [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
        ),
        (
          | {
              code:
                | "label_overlap"
                | "label_out_of_bounds"
                | "text_overflow"
                | "element_overlap"
                | "reading_order_conflict"
                | "measurement_unavailable";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
            }
          | {
              code: "region_crowded" | "board_imbalanced";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
          | {
              code: "region_sparse";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @maxItems 4
               */
              element_ids:
                [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
        ),
        (
          | {
              code:
                | "label_overlap"
                | "label_out_of_bounds"
                | "text_overflow"
                | "element_overlap"
                | "reading_order_conflict"
                | "measurement_unavailable";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
            }
          | {
              code: "region_crowded" | "board_imbalanced";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
          | {
              code: "region_sparse";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @maxItems 4
               */
              element_ids:
                [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
        ),
        (
          | {
              code:
                | "label_overlap"
                | "label_out_of_bounds"
                | "text_overflow"
                | "element_overlap"
                | "reading_order_conflict"
                | "measurement_unavailable";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
            }
          | {
              code: "region_crowded" | "board_imbalanced";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
          | {
              code: "region_sparse";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @maxItems 4
               */
              element_ids:
                [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
        ),
        (
          | {
              code:
                | "label_overlap"
                | "label_out_of_bounds"
                | "text_overflow"
                | "element_overlap"
                | "reading_order_conflict"
                | "measurement_unavailable";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
            }
          | {
              code: "region_crowded" | "board_imbalanced";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
          | {
              code: "region_sparse";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @maxItems 4
               */
              element_ids:
                [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
        ),
        (
          | {
              code:
                | "label_overlap"
                | "label_out_of_bounds"
                | "text_overflow"
                | "element_overlap"
                | "reading_order_conflict"
                | "measurement_unavailable";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
            }
          | {
              code: "region_crowded" | "board_imbalanced";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @minItems 1
               * @maxItems 4
               */
              element_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
          | {
              code: "region_sparse";
              evidence: "estimated" | "measured" | "semantic";
              /**
               * @maxItems 4
               */
              element_ids:
                [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
              zone:
                | "A1"
                | "A2"
                | "A3"
                | "B1"
                | "B2"
                | "B3"
                | "C1"
                | "C2"
                | "C3"
                | "D1"
                | "D2"
                | "D3"
                | "left"
                | "right"
                | "full";
            }
        )
      ];
  /**
   * Closed, redacted browser evidence for visual intent that did not become visible ink. These are unavailable IDs, not board elements.
   *
   * @maxItems 8
   */
  recovery_findings?:
    | []
    | [RecoveryFinding]
    | [RecoveryFinding, RecoveryFinding]
    | [RecoveryFinding, RecoveryFinding, RecoveryFinding]
    | [RecoveryFinding, RecoveryFinding, RecoveryFinding, RecoveryFinding]
    | [RecoveryFinding, RecoveryFinding, RecoveryFinding, RecoveryFinding, RecoveryFinding]
    | [RecoveryFinding, RecoveryFinding, RecoveryFinding, RecoveryFinding, RecoveryFinding, RecoveryFinding]
    | [
        RecoveryFinding,
        RecoveryFinding,
        RecoveryFinding,
        RecoveryFinding,
        RecoveryFinding,
        RecoveryFinding,
        RecoveryFinding
      ]
    | [
        RecoveryFinding,
        RecoveryFinding,
        RecoveryFinding,
        RecoveryFinding,
        RecoveryFinding,
        RecoveryFinding,
        RecoveryFinding,
        RecoveryFinding
      ];
}
export interface RecoveryFinding {
  finding_id: string;
  code:
    | "browser_invalid_step"
    | "browser_invalid_op"
    | "browser_duplicate_id"
    | "browser_unknown_reference"
    | "browser_invalid_expression"
    | "browser_invalid_equation"
    | "browser_invalid_axes"
    | "renderer_geometry_failed";
  intent:
    "step" | "text" | "equation" | "sketch" | "axes" | "curve" | "diagram" | "line" | "arrow" | "point" | "angle_arc";
  status: "pending" | "recovered" | "abandoned";
  /**
   * @maxItems 4
   */
  affected_element_ids: [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
  /**
   * @maxItems 4
   */
  affected_op_indexes: [] | [number] | [number, number] | [number, number, number] | [number, number, number, number];
  source_step_id?: string;
  neighborhood: {
    zone?:
      "A1" | "A2" | "A3" | "B1" | "B2" | "B3" | "C1" | "C2" | "C3" | "D1" | "D2" | "D3" | "left" | "right" | "full";
    /**
     * @maxItems 4
     */
    nearby_element_ids: [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
  };
}
export interface LessonContinuationSuccess {
  request_id: RequestId;
  prefix_version: number;
  done: false;
  step: LessonStep;
  repairs: number;
  sanitized_fields: number;
  continuation_receipt: Receipt;
  board_model: Model;
  board_reasoning_effort: ReasoningEffort;
  board_prompt_sha256: Sha256;
  repair_prompt_sha256: Sha256;
  continuation_prompt_sha256: Sha256;
  configuration_sha256: Sha256;
}
export interface LessonContinuationTerminal {
  request_id: RequestId;
  prefix_version: number;
  done: true;
  reason: TerminalReason;
  repairs: number;
  board_model: Model;
  board_reasoning_effort: ReasoningEffort;
  board_prompt_sha256: Sha256;
  repair_prompt_sha256: Sha256;
  continuation_prompt_sha256: Sha256;
  configuration_sha256: Sha256;
}
