interface SubprojectConfig {
  Name: string;
  Description?: string;
  Managers?: ManagerConfig[];
  Dplists?: string[];
  UpdateScripts?: string[];
  UninstallScripts?: string[];
}

interface AddonConfig {
  RepoName: string;
  Keywords: string[];
  Version: string;
  Description: string;
  OaVersion: string;
  Subprojects: SubprojectConfig[];
  Dependencies?: string[];
}

interface ManagerConfig {
  Name: string;
  StartMode: StartMode;
  Options: string;
  RestartOnUpdate?: boolean;
}

enum StartMode {
  Always = "always",
  Manual = "manual",
  Once = "once",
  Unknown = "",
}

export { AddonConfig, SubprojectConfig, ManagerConfig, StartMode };
