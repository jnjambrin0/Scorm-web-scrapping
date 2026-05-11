import { useCallback, useReducer } from "react";
import type { StringKey } from "../lib/i18n";
import {
  validateBlackboardUrl,
  validateNotionUuid,
  type ValidationResult,
} from "../lib/validators";

export interface FormValues {
  courseOutlineUrl: string;
  scormTitle: string;
  notionParentPageTitle: string;
  notionParentPageId: string;
  notionPageTitle: string;
  markdownOutput: string;
  refresh: boolean;
  deleteAfter: boolean;
}

export type FieldKey = keyof FormValues;
export type FieldErrors = Partial<Record<FieldKey, StringKey>>;
type FieldTouched = Partial<Record<FieldKey, boolean>>;

interface State {
  values: FormValues;
  errors: FieldErrors;
  touched: FieldTouched;
}

const INITIAL_VALUES: FormValues = {
  courseOutlineUrl: "",
  scormTitle: "",
  notionParentPageTitle: "Universidad",
  notionParentPageId: "",
  notionPageTitle: "",
  markdownOutput: "",
  refresh: false,
  deleteAfter: false,
};

type Action =
  | { type: "update"; key: FieldKey; value: FormValues[FieldKey] }
  | { type: "blur"; key: FieldKey; result: ValidationResult }
  | { type: "validate"; errors: FieldErrors; touched: FieldTouched }
  | { type: "merge"; partial: Partial<FormValues> }
  | { type: "reset" };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "update": {
      const nextErrors = { ...state.errors };
      delete nextErrors[action.key];
      return {
        ...state,
        values: { ...state.values, [action.key]: action.value },
        errors: nextErrors,
      };
    }
    case "blur": {
      const nextErrors = { ...state.errors };
      if (action.result.ok) {
        delete nextErrors[action.key];
      } else if (action.result.messageKey) {
        nextErrors[action.key] = action.result.messageKey;
      }
      return {
        ...state,
        touched: { ...state.touched, [action.key]: true },
        errors: nextErrors,
      };
    }
    case "validate": {
      return { ...state, errors: action.errors, touched: action.touched };
    }
    case "merge": {
      return { ...state, values: { ...state.values, ...action.partial } };
    }
    case "reset":
      return { values: INITIAL_VALUES, errors: {}, touched: {} };
    default:
      return state;
  }
}

const FIELD_VALIDATORS: Partial<Record<FieldKey, (value: string) => ValidationResult>> = {
  courseOutlineUrl: validateBlackboardUrl,
  notionParentPageId: validateNotionUuid,
};

function runValidator(
  key: FieldKey,
  value: FormValues[FieldKey],
): ValidationResult {
  const validator = FIELD_VALIDATORS[key];
  if (!validator || typeof value !== "string") {
    return { ok: true };
  }
  return validator(value);
}

export interface UseFormState {
  values: FormValues;
  errors: FieldErrors;
  touched: FieldTouched;
  update: <K extends FieldKey>(key: K, value: FormValues[K]) => void;
  blur: (key: FieldKey) => void;
  validate: () => { ok: boolean; errors: FieldErrors; firstErrorKey: FieldKey | null };
  merge: (partial: Partial<FormValues>) => void;
  reset: () => void;
}

/**
 * @param initialOverrides Optional values that override `INITIAL_VALUES` on
 *   mount. Used to seed the form from persisted user settings.
 */
export function useFormState(initialOverrides?: Partial<FormValues>): UseFormState {
  const [state, dispatch] = useReducer(reducer, {
    values: { ...INITIAL_VALUES, ...(initialOverrides ?? {}) },
    errors: {},
    touched: {},
  });

  const update = useCallback<UseFormState["update"]>((key, value) => {
    dispatch({ type: "update", key, value });
  }, []);

  const blur = useCallback((key: FieldKey) => {
    dispatch({ type: "blur", key, result: runValidator(key, state.values[key]) });
  }, [state.values]);

  const validate = useCallback(() => {
    const errors: FieldErrors = {};
    const touched: FieldTouched = {};
    let firstErrorKey: FieldKey | null = null;
    for (const key of Object.keys(FIELD_VALIDATORS) as FieldKey[]) {
      const result = runValidator(key, state.values[key]);
      touched[key] = true;
      if (!result.ok && result.messageKey) {
        errors[key] = result.messageKey;
        if (!firstErrorKey) firstErrorKey = key;
      }
    }
    dispatch({ type: "validate", errors, touched });
    return { ok: !firstErrorKey, errors, firstErrorKey };
  }, [state.values]);

  const merge = useCallback((partial: Partial<FormValues>) => {
    dispatch({ type: "merge", partial });
  }, []);

  const reset = useCallback(() => {
    dispatch({ type: "reset" });
  }, []);

  return {
    values: state.values,
    errors: state.errors,
    touched: state.touched,
    update,
    blur,
    validate,
    merge,
    reset,
  };
}
