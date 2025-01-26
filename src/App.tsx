import React from 'react';
import PsychometricAssessment from './components/PsychometricAssessment';
// import CaseStudyAssessment from './components/CaseStudyAssessment';

function App() {
  // In a real application, you would get these values from your authentication system
  // and job application process. For now, we'll use dummy values.
  // const jobId = 4511;
  const jobId = 6528;
  const compId = 2806;
  // const candidateId = 6;
  const username = "kaurnan5656@gmail.com";

  return (
    <div className="App">
      <PsychometricAssessment 
        jobId={jobId}
        compId={compId}
        // candidateId={candidateId}
        username={username}
      />
      {/* <CaseStudyAssessment 
        jobId={jobId}
        compId={compId}
        candidateId={candidateId}
        candidateName={candidateName} 
        assessmentType="caseStudy" 
      /> */}
    </div>
  );
}

export default App;