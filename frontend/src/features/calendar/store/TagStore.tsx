import { createContext, useContext, useReducer, useEffect, ReactNode, useState } from 'react';
import { Tag, EventTagMapping } from '../../../shared/types';
import { cacheGetStale, cacheSet } from '../utils/eventCache';

const STORAGE_KEY_TAGS = 'calendar-desktop-tags';
const STORAGE_KEY_MAPPINGS = 'calendar-event-tags';

type TagsAction =
  | { type: 'ADD'; payload: Tag }
  | { type: 'REMOVE'; payload: string }
  | { type: 'UPDATE'; payload: { id: string; data: Partial<Tag> } };

type MappingsAction =
  | { type: 'INIT'; payload: EventTagMapping }
  | { type: 'SET'; payload: { seriesId: string; tagId: string } }
  | { type: 'REMOVE'; payload: string }; // seriesId

function tagsReducer(state: Tag[], action: TagsAction): Tag[] {
  switch (action.type) {
    case 'ADD':
      return [...state, action.payload];
    case 'REMOVE':
      return state.filter((t) => t.id !== action.payload);
    case 'UPDATE':
      return state.map((t) =>
        t.id === action.payload.id ? { ...t, ...action.payload.data } : t
      );
  }
}

function mappingsReducer(state: EventTagMapping, action: MappingsAction): EventTagMapping {
  switch (action.type) {
    case 'INIT':
      return action.payload;
    case 'SET':
      return { ...state, [action.payload.seriesId]: action.payload.tagId };
    case 'REMOVE': {
      const copy = { ...state };
      delete copy[action.payload];
      return copy;
    }
  }
}

interface TagContextValue {
  tags: Tag[];
  eventTags: EventTagMapping;
  addTag: (name: string, color: string) => void;
  removeTag: (id: string) => void;
  updateTag: (id: string, data: Partial<Tag>) => void;
  setEventTag: (seriesId: string, tagId: string) => void;
  removeEventTag: (seriesId: string) => void;
  isLoaded: boolean;
}

const TagContext = createContext<TagContextValue | null>(null);

export function TagProvider({ children }: { children: ReactNode }) {
  const [tags, dispatchTags] = useReducer(tagsReducer, [], () => {
    const stored = localStorage.getItem(STORAGE_KEY_TAGS);
    return stored ? (JSON.parse(stored) as Tag[]) : [];
  });

  const [eventTags, dispatchMappings] = useReducer(mappingsReducer, {});
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    cacheGetStale<EventTagMapping>(STORAGE_KEY_MAPPINGS).then((data) => {
      if (data) dispatchMappings({ type: 'INIT', payload: data });
      setIsLoaded(true);
    }).catch(() => setIsLoaded(true));
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_TAGS, JSON.stringify(tags));
  }, [tags]);

  useEffect(() => {
    if (isLoaded) {
      void cacheSet(STORAGE_KEY_MAPPINGS, eventTags);
    }
  }, [eventTags, isLoaded]);

  const addTag = (name: string, color: string) =>
    dispatchTags({ type: 'ADD', payload: { id: crypto.randomUUID(), name, color } });

  const removeTag = (id: string) => {
    dispatchTags({ type: 'REMOVE', payload: id });
    // Also remove any mappings associated with this tag
    Object.entries(eventTags).forEach(([seriesId, tagId]) => {
      if (tagId === id) {
        dispatchMappings({ type: 'REMOVE', payload: seriesId });
      }
    });
  };

  const updateTag = (id: string, data: Partial<Tag>) =>
    dispatchTags({ type: 'UPDATE', payload: { id, data } });

  const setEventTag = (seriesId: string, tagId: string) =>
    dispatchMappings({ type: 'SET', payload: { seriesId, tagId } });

  const removeEventTag = (seriesId: string) =>
    dispatchMappings({ type: 'REMOVE', payload: seriesId });

  return (
    <TagContext.Provider
      value={{
        tags,
        eventTags,
        addTag,
        removeTag,
        updateTag,
        setEventTag,
        removeEventTag,
        isLoaded,
      }}
    >
      {children}
    </TagContext.Provider>
  );
}

export function useTags() {
  const ctx = useContext(TagContext);
  if (!ctx) throw new Error('useTags must be used within TagProvider');
  return ctx;
}
