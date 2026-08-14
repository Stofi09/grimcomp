import { createContext } from 'react';
import { ContentRegistry } from './registry';

export interface ContentStatus {
  loading: boolean;
  errors: string[];
}

export const ContentContext = createContext<ContentRegistry>(new ContentRegistry([]));

export const ContentStatusContext = createContext<ContentStatus>({
  loading: true,
  errors: [],
});
