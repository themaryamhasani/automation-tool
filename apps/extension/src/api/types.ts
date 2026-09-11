export interface ProjectSummary {
  id: string;
  name: string;
  code: string;
  isActive: boolean;
  sourceApproach?: 'CDE' | 'IS' | 'GITHUB' | 'GIT_EDUS' | 'ZIP';
}

export interface EnvironmentSummary {
  id: string;
  name: string;
  baseUrl: string;
  enabled: boolean;
  availableNow?: boolean;
}

export interface FolderSummary {
  folderPath: string;
  fileCount: number;
}

export interface TestFileSummary {
  id: string;
  projectId: string;
  folderPath: string;
  fileName: string;
  fullPath: string;
  revision: number;
  sourceCode: string;
}

export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface RunSummary {
  id: string;
  status: string;
  projectId: string;
  testFileId?: string | null;
}

export interface AuthProfile {
  user: { id: string; fullName: string; role: 'ADMIN' | 'OPERATOR' | 'VIEWER' };
  projectIds: string[];
}
