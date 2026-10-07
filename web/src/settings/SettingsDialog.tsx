import { useEffect, useRef, useState } from "react";
import { parseApiUrl } from "../api/url.ts";
import type { ApiUrlSetting } from "./api-url-store.ts";

interface Props {
  setting: ApiUrlSetting;
  onSave: (url: string) => void;
  onReset: () => void;
  onCancel: () => void;
}

/** FR-017/FR-018: see, change and restore the API URL. Only absolute http/https is accepted. */
export function SettingsDialog({ setting, onSave, onReset, onCancel }: Props) {
  const [value, setValue] = useState(setting.url);
  const [error, setError] = useState<string | null>(null);
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancelRef.current();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  function save() {
    const parsed = parseApiUrl(value);
    if (!parsed.ok) {
      setError(parsed.reason);
      return;
    }
    onSave(parsed.url);
  }

  return (
    <div
      className="backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <form
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Configurações"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <h2>Configurações</h2>
        <label htmlFor="api-url">URL da API</label>
        <input
          id="api-url"
          type="text"
          autoFocus
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setError(null);
          }}
        />
        {error && (
          <div className="field-error" role="alert">
            {error}
          </div>
        )}
        {!setting.persistent && (
          <div className="field-warn">
            O armazenamento do navegador está indisponível: a escolha não será lembrada ao recarregar a página.
          </div>
        )}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onReset}>
            Restaurar padrão
          </button>
          <button type="button" className="btn" onClick={onCancel}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary">
            Salvar
          </button>
        </div>
      </form>
    </div>
  );
}
