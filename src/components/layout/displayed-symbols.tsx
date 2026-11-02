"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

/** 「畫面上現在顯示哪些標的的報價」的登記處。
 *  顯示報價的元件各自用 useDisplayedSymbols 登記自己這一刻畫出來的標的
 *  （例如 Market 只登記目前選中的追蹤清單、本日持倉表現只登記篩選後的持股），
 *  頁面用 DisplayedSymbolsProvider 收集聯集，拿去判斷要不要自動更新——
 *  沒顯示的清單就算在交易時段，也不會讓頁面一直更新。 */

type Registry = {
  set: (token: object, symbols: readonly string[]) => void;
  remove: (token: object) => void;
};

const DisplayedSymbolsContext = createContext<Registry | null>(null);

export function DisplayedSymbolsProvider({
  onChange,
  children,
}: {
  onChange: (symbols: string[]) => void;
  children: ReactNode;
}) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const registry = useMemo<Registry>(() => {
    const entries = new Map<object, readonly string[]>();
    let lastKey = "";
    const emit = () => {
      const all = [...new Set([...entries.values()].flat())].sort();
      const key = all.join("|");
      if (key === lastKey) return;
      lastKey = key;
      onChangeRef.current(all);
    };
    return {
      set: (token, symbols) => {
        entries.set(token, symbols);
        emit();
      },
      remove: (token) => {
        entries.delete(token);
        emit();
      },
    };
  }, []);

  return (
    <DisplayedSymbolsContext.Provider value={registry}>
      {children}
    </DisplayedSymbolsContext.Provider>
  );
}

/** 登記這個元件目前畫在畫面上的標的；元件卸載時自動取消 */
export function useDisplayedSymbols(symbols: readonly string[]): void {
  const registry = useContext(DisplayedSymbolsContext);
  const [token] = useState(() => ({}));
  const key = symbols.join("|");

  useEffect(() => {
    registry?.set(token, key ? key.split("|") : []);
  }, [registry, token, key]);

  useEffect(() => () => registry?.remove(token), [registry, token]);
}
