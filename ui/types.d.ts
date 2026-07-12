interface DtAppConfig {
  environmentUrl: string;
  apiToken: string;
  [key: string]: any;
}

declare global {
  interface Window {
    dtAppConfig?: DtAppConfig;
  }
}

export {};
