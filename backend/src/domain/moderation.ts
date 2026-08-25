import type { ModerationCategory, ModerationDecision } from '../contracts/ai/assistant.js';

export type ScreenDecision = ModerationDecision | 'review';

export interface ScreenResult {
  readonly decision: ScreenDecision;
  readonly category: ModerationCategory;
  
  readonly rule: number | null;
}

const ALLOWED: ScreenResult = { decision: 'allow', category: 'none', rule: null };

const HOMOGLYPHS: ReadonlyMap<string, string> = new Map([
  ['a', 'а'],
  ['b', 'ь'],
  ['c', 'с'],
  ['e', 'е'],
  ['h', 'н'],
  ['k', 'к'],
  ['m', 'м'],
  ['o', 'о'],
  ['p', 'р'],
  ['t', 'т'],
  ['u', 'и'],
  ['x', 'х'],
  ['y', 'у'],
]);

const HOMOGLYPH_CLASS = new RegExp(`[${[...HOMOGLYPHS.keys()].join('')}]`, 'gu');

function fold(text: string): string {
  return text.replace(HOMOGLYPH_CLASS, (char) => HOMOGLYPHS.get(char) ?? char);
}

const LEET: ReadonlyMap<string, string> = new Map([
  ['0', 'о'],
  ['1', 'и'],
  ['3', 'е'],
  ['4', 'а'],
  ['6', 'б'],
  ['@', 'а'],
  ['$', 's'],
]);

const LEET_CLASS = new RegExp(`[${[...LEET.keys()].join('')}]`, 'gu');

function deleet(text: string): string {
  return text.replace(LEET_CLASS, (char) => LEET.get(char) ?? char);
}

const SPACED_LETTERS = /(?:\p{L}[ .\-_*·]){2,}\p{L}/gu;
const SEPARATORS = /[ .\-_*·]/gu;

function collapseSpacedLetters(text: string): string {
  return text.replace(SPACED_LETTERS, (run) => run.replace(SEPARATORS, ''));
}

function normalizeForMatching(lower: string): string {
  return fold(deleet(collapseSpacedLetters(lower)));
}

interface Rule {
  readonly pattern: RegExp;
  readonly decision: ScreenDecision;
  readonly category: ModerationCategory;
}

const RULES: readonly Rule[] = [
  
  {
    pattern:
      /(покончить\s+с\s+собой|свести\s+счёты\s+с\s+жизнью|не\s+хочу\s+(больше\s+)?жить|хочу\s+умереть|суицид|самоубийств|порезать\s+себ|причинить\s+себе\s+вред|өз[- ]?өзіне\s+қол\s+жұм|kill\s+myself|end\s+my\s+life|self[- ]?harm|suicide)/u,
    decision: 'block',
    category: 'self_harm',
  },

  
  {
    pattern:
      /(порн|porn|эрот|erotic|секс(?!олог)|нюдс|nudes|интимн\w*\s+фото|nsfw|хентай|hentai|onlyfans)/u,
    decision: 'block',
    category: 'nsfw',
  },

  
  
  
  {
    pattern:
      /(как\s+(с|из)готовить|как\s+сделать|как\s+собрать|рецепт|инструкц\w+\s+по)\s+[^\n]{0,40}(бомб|взрывчат|взрывно\w+\s+устройств|напалм|отрав|яд\b|наркотик|метамфетамин|тротил|коктейл\w*\s+молотов)/u,
    decision: 'block',
    category: 'nsfl',
  },
  {
    pattern:
      /(как\s+(убить|зарезать|отравить|задушить)\s+(человек|люд|его|её|их|друг|одноклассник|учител)|расчлен|пытк\w+\s+над)/u,
    decision: 'block',
    category: 'nsfl',
  },

  
  
  
  {
    pattern:
      /(за\s+кого\s+(мне\s+)?(голосовать|проголосовать)|кака\w+\s+партия\s+(лучше|правильн)|кто\s+должен\s+(быть\s+)?президент|стоит\s+ли\s+(идти\s+на\s+)?(митинг|протест)|кто\s+прав\s+в\s+(войне|конфликте)|поддерживаешь\s+ли\s+ты\s+(войну|власть|оппозиц))/u,
    decision: 'redirect',
    category: 'political',
  },
  {
    pattern:
      /(агитац|пропаганд\w*\s+(за|против)\s+\w+|призыв\w*\s+к\s+(насил|сверж)|экстремист\w*\s+(материал|литератур)|вступить\s+в\s+(игил|isis|запрещённ))/u,
    decision: 'redirect',
    category: 'ideological',
  },

  
  
  
  {
    pattern:
      /(игнорируй\s+(все\s+)?(предыдущ|прежн|выше)|ignore\s+(all\s+)?(previous|prior|above)|забудь\s+(инструкц|правил|всё)|системн\w*\s+промпт|system\s*prompt|ты\s+теперь\s+(не|другой|новый)|you\s+are\s+now\s+(a|an|no\s+longer)|jailbreak|джейлбрейк|<\/?untrusted_data|притворись,?\s+что\s+ты\s+(не|больше\s+не))/u,
    decision: 'redirect',
    category: 'prompt_injection',
  },

  
  
  
  {
    pattern:
      /(наркотик|героин|кокаин|спайс|вейп|курить|алкогол|водк|пиво|оруж|пистолет|автомат\s+калашников|нож\w*\s+для|драк|избить|секта|терракт|теракт|казн)/u,
    decision: 'review',
    category: 'other',
  },
  {
    pattern: /(депресс|тревожност|паническ\w+\s+атак|психолог|булл|травл|издевают)/u,
    decision: 'review',
    category: 'self_harm',
  },
];

const REQUIRED_SPACE = /\\s\+/gu;

const TIGHT_RULES: readonly RegExp[] = RULES.map(
  (rule) => new RegExp(rule.pattern.source.replace(REQUIRED_SPACE, '\\s*'), 'u'),
);

const STUDY_MARKERS =
  /(параграф|учебник|задач|уравнен|формул|реакц|тема\s+урок|контрольн|дз\b|домашн|экзамен|ент\b|ниш\b|олимпиад|сочинен|роман|повест|рассказ|стихотворен|автор|глав\w+\s+\d|§|\b1[0-9]{3}\b|\b20[0-2][0-9]\b|век[аеу]?\b|истори|биолог|хими|физик|литератур|обществознан|правов|закон\w*\s+о)/u;

const TIGHT_STUDY_MARKERS = new RegExp(STUDY_MARKERS.source.replace(REQUIRED_SPACE, '\\s*'), 'u');

export function screenMessage(text: string): ScreenResult {
  const lower = text.toLowerCase().normalize('NFC');
  const normalized = normalizeForMatching(lower);
  const hasStudyMarker = STUDY_MARKERS.test(lower) || TIGHT_STUDY_MARKERS.test(normalized);

  for (const [index, rule] of RULES.entries()) {
    
    
    const tight = TIGHT_RULES[index];
    if (!rule.pattern.test(lower) && tight?.test(normalized) !== true) {
      continue;
    }

    
    
    if (rule.decision === 'review' && hasStudyMarker) {
      continue;
    }

    return { decision: rule.decision, category: rule.category, rule: index };
  }

  return ALLOWED;
}

export const NATIONAL_HELPLINE = '150';
export const ALMATY_HELPLINE = '1303';

export function refusalText(category: ModerationCategory): string {
  switch (category) {
    case 'self_harm':
      return [
        'Мне жаль, что тебе сейчас тяжело. Я учебный помощник и не могу здесь помочь — ',
        'но с этим точно не нужно оставаться одному.',
        '\n\n',
        'Пожалуйста, расскажи взрослому, которому доверяешь: родителям, школьному ',
        'психологу или классному руководителю.',
        '\n\n',
        'А если хочется поговорить прямо сейчас — в Казахстане есть телефоны ',
        'доверия. Бесплатно и анонимно:',
        '\n\n',
        `- **${NATIONAL_HELPLINE}** — национальный телефон доверия, для детей и взрослых;`,
        '\n',
        `- **${ALMATY_HELPLINE}** — телефон доверия Центра психического здоровья, Алматы.`,
        '\n\n',
        'Я останусь здесь по учёбе, когда захочешь вернуться.',
      ].join('');

    case 'nsfw':
      return 'Это за пределами того, с чем я помогаю. Давай вернёмся к учёбе — спроси про тему, задачу или урок.';

    case 'nsfl':
      return 'С этим я не помогу. Могу разобрать тему по программе — например, объяснить материал или решить задачу.';

    case 'political':
    case 'ideological':
      return [
        'Оценивать политические взгляды — не моя работа, и правильного ответа тут ',
        'у меня нет. А вот исторические события разберу с удовольствием: причины, ',
        'ход, последствия — всё по программе. Спроси так, и я отвечу.',
      ].join('');

    case 'prompt_injection':
      return 'Мои правила не меняются по просьбе — я учебный помощник и останусь им. Спроси что-нибудь по учёбе, и я помогу.';

    case 'out_of_scope':
      return 'Это не по школьной программе. Спроси про тему, задачу или урок — здесь я полезнее всего.';

    case 'none':
    case 'other':
      return 'Этот вопрос я разобрать не берусь. Задай его как учебный — про тему, задачу или урок, — и я помогу.';
  }
}

export function unclearQuestionText(): string {
  return [
    'Я не понял, что именно нужно. Попробуй спросить конкретнее: назови предмет ',
    'и тему или приведи само задание — тогда разберу по шагам.',
  ].join('');
}

export function unreviewedText(): string {
  return [
    'Этот вопрос я пока не берусь разбирать: он требует проверки, а она сейчас ',
    'недоступна. Попробуй задать его как учебный — назови предмет и тему, — тогда ',
    'я отвечу сразу.',
  ].join('');
}
