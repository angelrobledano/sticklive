export const Platform = {
  OS: 'android',
  select: <T>(obj: { android?: T; ios?: T; default?: T }): T | undefined => obj.android ?? obj.default,
};

export const AppState = {
  currentState: 'active',
  addEventListener: () => ({ remove: () => {} }),
};
