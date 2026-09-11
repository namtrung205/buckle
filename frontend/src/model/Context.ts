import { createContext, useContext } from 'react';
import { Model } from './Model';
import { ContributionRegistry } from '../core/plugins';

type AppContextType = {
  model: Model;
  contributions: ContributionRegistry;
};

export const useAppContext = () => {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useAppContext must be used within an AppProvider');
  }
  return context;
};
export const AppContext = createContext<AppContextType | undefined>(undefined);
export const useModel = () => useAppContext().model;
export const useContributions = () => useAppContext().contributions;
