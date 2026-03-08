declare namespace NodeJS {
  interface Process {
    resourcesPath: string;
    defaultApp?: boolean;
  }
}
