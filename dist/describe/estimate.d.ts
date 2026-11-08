import { EstimateOperation } from '../types/enums';
import type { EstimateReport } from '../types';
declare const 
/** Build report of operations */
estimateReport: (operations: EstimateOperation[]) => EstimateReport, 
/** Record one measured operation */
recordEstimate: ({ operation, seconds, }: {
    operation: EstimateOperation;
    seconds: number;
}) => void, 
/** Clear measured estimates */
resetEstimates: () => void;
export { estimateReport, recordEstimate, resetEstimates };
