export interface ParsedLotItem {
    text: string;
    checked: boolean;
}
export interface ParsedLot {
    title: string;
    checked: boolean;
    items: ParsedLotItem[];
}
export interface ParsedBranchMd {
    title: string;
    allowedPaths: string[];
    forbiddenPaths: string[];
    conditionalPaths: string[];
    exceptions: string[];
    lots: ParsedLot[];
}
export declare function parseBranchMd(text: string): ParsedBranchMd;
