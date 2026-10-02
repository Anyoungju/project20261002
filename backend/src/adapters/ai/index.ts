import sharp from 'sharp';
import { env } from '../../config/env';

/** research R7 — AiAnalyzer 경계. 응답 스키마 위반·타임아웃·오류는 모두 AiFailure(G4) */
export type RiskLevel = 'normal' | 'caution' | 'danger';

export interface AiAnalysis {
  causes: Array<{ rank: number; text: string }>;
  actions: Array<{ seq: number; text: string }>;
  riskLevel: RiskLevel;
  confidence: number;
  defectTypeGuess?: 'crack' | 'leak' | 'condensation' | null;
}

export interface AiInput {
  photos: Buffer[];
  description: string | null;
}

export class AiFailure extends Error {
  constructor(
    message: string,
    public kind: 'timeout' | 'error' | 'schema' = 'error',
  ) {
    super(message);
  }
}

export interface AiAnalyzer {
  readonly name: string;
  analyze(input: AiInput): Promise<AiAnalysis>;
}

export const AI_TIMEOUT_MS = 45_000;

function validate(x: any): AiAnalysis {
  const okRisk = ['normal', 'caution', 'danger'];
  if (!x || !Array.isArray(x.causes) || !x.causes.length || !Array.isArray(x.actions) || !x.actions.length) {
    throw new AiFailure('AI 응답에 원인·대응방안이 없습니다', 'schema');
  }
  if (!okRisk.includes(x.risk_level ?? x.riskLevel)) throw new AiFailure('AI 응답 위험도 형식 오류', 'schema');
  const conf = Number(x.confidence);
  if (!(conf >= 0 && conf <= 1)) throw new AiFailure('AI 응답 신뢰도 형식 오류', 'schema');
  return {
    causes: x.causes.slice(0, 5).map((c: any, i: number) => ({ rank: i + 1, text: String(c.text ?? c).slice(0, 300) })),
    actions: x.actions.slice(0, 5).map((a: any, i: number) => ({ seq: i + 1, text: String(a.text ?? a).slice(0, 500) })),
    riskLevel: (x.risk_level ?? x.riskLevel) as RiskLevel,
    confidence: Math.round(conf * 1000) / 1000,
    defectTypeGuess: x.defect_type_guess ?? x.defectTypeGuess ?? null,
  };
}

// ---------------------------------------------------------------- Mock
/** 시나리오: normal · caution · danger · lowconf · fail · timeout. 설명의 #태그 또는 MOCK_AI_SCENARIO */
const MOCK: Record<string, any> = {
  normal: {
    causes: [{ text: '콘크리트 건조 수축에 의한 표면 미세 균열' }, { text: '온도 변화에 따른 마감재 신축' }],
    actions: [{ text: '균열 폭을 30일 간격으로 재촬영해 진행 여부를 확인합니다' }, { text: '진행이 없으면 표면 보수재로 마감합니다' }],
    risk_level: 'normal',
    confidence: 0.86,
    defect_type_guess: 'crack',
  },
  caution: {
    causes: [{ text: '실내외 온도차로 인한 표면 결로' }, { text: '환기 부족으로 인한 습기 정체' }, { text: '단열재 시공 불량 가능성' }],
    actions: [{ text: '하루 2회 이상 환기하고 제습기를 사용합니다' }, { text: '결로가 반복되면 단열 상태 점검을 받으세요' }],
    risk_level: 'caution',
    confidence: 0.74,
    defect_type_guess: 'condensation',
  },
  danger: {
    causes: [{ text: '상부 슬래브 방수층 손상으로 인한 누수' }, { text: '배관 접합부 파손' }, { text: '구조체 균열을 통한 우수 유입' }],
    actions: [{ text: '누수 부위 아래 전기 설비 사용을 중지하고 차단합니다' }, { text: '자격 있는 전문가의 방수·구조 점검을 받으세요' }],
    risk_level: 'danger',
    confidence: 0.81,
    defect_type_guess: 'leak',
  },
  lowconf: {
    causes: [{ text: '마감재 들뜸 또는 얼룩 — 사진만으로 원인 특정이 어렵습니다' }],
    actions: [{ text: '다른 각도에서 가까이 찍은 사진으로 다시 확인합니다' }],
    risk_level: 'normal',
    confidence: 0.42,
    defect_type_guess: null,
  },
};

export class MockAnalyzer implements AiAnalyzer {
  readonly name = 'mock';
  async analyze(input: AiInput): Promise<AiAnalysis> {
    const tag = /#(normal|caution|danger|lowconf|fail|timeout)\b/i.exec(input.description ?? '')?.[1]?.toLowerCase();
    let scenario = tag ?? env.MOCK_AI_SCENARIO ?? '';
    if (env.MOCK_AI_FAIL) scenario = 'fail';
    if (!scenario) {
      // 설명 키워드로 그럴듯하게 고른다
      const d = input.description ?? '';
      scenario = /누수|물|샘|leak/i.test(d) ? 'danger' : /결로|곰팡이|습기/i.test(d) ? 'caution' : 'normal';
    }
    await new Promise((r) => setTimeout(r, 600));
    if (scenario === 'fail') throw new AiFailure('mock AI 실패', 'error');
    if (scenario === 'timeout') throw new AiFailure('mock AI 타임아웃', 'timeout');
    return validate(MOCK[scenario] ?? MOCK.normal);
  }
}

// ---------------------------------------------------------------- Gemini
export class GeminiAnalyzer implements AiAnalyzer {
  readonly name = 'gemini';
  async analyze(input: AiInput): Promise<AiAnalysis> {
    if (!env.GEMINI_API_KEY) throw new AiFailure('GEMINI_API_KEY 가 없습니다', 'error');
    const { GoogleGenAI, Type } = await import('@google/genai');
    const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
    const images = await Promise.all(
      input.photos.slice(0, 4).map(async (b) => ({
        inlineData: {
          mimeType: 'image/jpeg',
          data: (await sharp(b).rotate().resize(1600, 1600, { fit: 'inside' }).jpeg({ quality: 85 }).toBuffer()).toString('base64'),
        },
      })),
    );
    const prompt =
      '당신은 건축물 하자 1차 분석 보조입니다. 사진과 설명을 보고 가능한 원인을 가능성 순으로 1~3개, 대응방안 1~3개를 한국어로 제시하세요. ' +
      '위험도는 normal(정상)·caution(주의)·danger(위험) 중 하나, confidence 는 0~1. 법적·구조적 안전 판정을 하지 마세요.\n' +
      `사용자 설명: ${input.description ?? '(없음)'}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), AI_TIMEOUT_MS);
    const started = Date.now();
    try {
      const resp = await ai.models.generateContent({
        model: env.GEMINI_MODEL,
        contents: [{ role: 'user', parts: [{ text: prompt }, ...images] }],
        config: {
          abortSignal: ctrl.signal,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              causes: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { text: { type: Type.STRING } }, required: ['text'] } },
              actions: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { text: { type: Type.STRING } }, required: ['text'] } },
              risk_level: { type: Type.STRING, enum: ['normal', 'caution', 'danger'] },
              confidence: { type: Type.NUMBER },
              defect_type_guess: { type: Type.STRING, enum: ['crack', 'leak', 'condensation'], nullable: true },
            },
            required: ['causes', 'actions', 'risk_level', 'confidence'],
          },
        },
      });
      const text = resp.text ?? '';
      return validate(JSON.parse(text));
    } catch (e: any) {
      if (e instanceof AiFailure) throw e;
      if (ctrl.signal.aborted) throw new AiFailure('AI 응답 시간 초과', 'timeout');
      throw new AiFailure(`AI 호출 실패: ${e.message}`, e instanceof SyntaxError ? 'schema' : 'error');
    } finally {
      clearTimeout(timer);
      console.log(`[ai:gemini] ${Date.now() - started}ms`);
    }
  }
}

let analyzer: AiAnalyzer | null = null;
export function aiAnalyzer(): AiAnalyzer {
  if (!analyzer) analyzer = env.AI_PROVIDER === 'gemini' ? new GeminiAnalyzer() : new MockAnalyzer();
  return analyzer;
}
export function setAiAnalyzer(a: AiAnalyzer | null): void {
  analyzer = a;
}
