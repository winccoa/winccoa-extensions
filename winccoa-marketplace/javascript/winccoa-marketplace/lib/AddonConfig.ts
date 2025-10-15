interface AddonConfig {
  RepoName: string;
  Keywords: string[];
  Subproject: string;
  Version: string;
  Description: string;
  OaVersion: string;
  Managers?: ManagerConfig[];
  Dplists?: string[];
  UpdateScripts?: string[];
} 

interface ManagerConfig {
    Name: string;
    StartMode: StartMode;
    Options: string;
}

enum StartMode {
    Always = "always",
    Manual = "manual",
    Once = "once",
    Unknown = ""
}

export { AddonConfig, ManagerConfig, StartMode };