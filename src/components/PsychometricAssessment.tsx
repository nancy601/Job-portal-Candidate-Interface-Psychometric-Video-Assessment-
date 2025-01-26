'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Button } from "./ui/button"
import { Card } from "./ui/card"
import { MoreHorizontal, Mic } from 'lucide-react'

interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
}

interface SpeechRecognitionResultList {
  [index: number]: SpeechRecognitionResult;
  length: number;
}

interface SpeechRecognitionResult {
  [index: number]: SpeechRecognitionAlternative;
  isFinal: boolean;
  length: number;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: (event: SpeechRecognitionEvent) => void;
  onend: () => void;
  onerror: (event: SpeechRecognitionErrorEvent) => void;
  onstart: () => void;
  start: () => void;
  stop: () => void;
}

declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognition;
    webkitSpeechRecognition: new () => SpeechRecognition;
  }
}

interface Question {
  question: string;
  points: number;
}

interface Scenario {
  scenario_id: number;
  scenario: string;
  questions: Question[];
}

interface PsychometricAssessmentProps {
  jobId: number;
  compId: number;
  username: string;
}

export default function Component({ jobId, compId, username }: PsychometricAssessmentProps) {
  const [scenarios, setScenarios] = useState<Scenario[]>([])
  const [currentScenario, setCurrentScenario] = useState(0)
  const [currentQuestion, setCurrentQuestion] = useState(0)
  const [recording, setRecording] = useState(false)
  const [psyTimeSpent, setPsyTimeSpent] = useState(0)
  const [transcript, setTranscript] = useState("")
  const [assessmentStarted, setAssessmentStarted] = useState(false)
  const [isListening, setIsListening] = useState(false)
  const [assessmentId, setAssessmentId] = useState<number | null>(null)
  const [department, setDepartment] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const videoRef = useRef<HTMLVideoElement>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const recognitionRef = useRef<SpeechRecognition | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const psyTimerRef = useRef<NodeJS.Timeout | null>(null)
  const startTimeRef = useRef<number>(0)

  const fetchScenariosAndQuestions = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)
      const response = await fetch(`http://127.0.0.1:5000/get_scenarios_and_questions?job_id=${jobId}&comp_id=${compId}`)
      if (!response.ok) {
        throw new Error('Failed to fetch scenarios and questions')
      }
      const data = await response.json()
      if (!Array.isArray(data.psy_questions) || data.psy_questions.length === 0) {
        throw new Error('No scenarios available')
      }
      setScenarios(data.psy_questions)
      setDepartment(data.department || 'Unknown Department')
    } catch (error) {
      console.error('Error fetching scenarios and questions:', error)
      setError(error instanceof Error ? error.message : 'An unknown error occurred')
    } finally {
      setIsLoading(false)
    }
  }, [jobId, compId])

  const saveCurrentVideo = useCallback(async () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      return new Promise<void>((resolve) => {
        mediaRecorderRef.current!.onstop = async () => {
          if (chunksRef.current.length > 0 && assessmentId) {
            const blob = new Blob(chunksRef.current, { type: 'video/webm' })
            const formData = new FormData()
            formData.append('video', blob, 'video.webm')
            formData.append('assessmentId', assessmentId.toString())
            formData.append('scenarioId', scenarios[currentScenario]?.scenario_id.toString() || '')
            formData.append('questionIndex', currentQuestion.toString())
            formData.append('questionText', scenarios[currentScenario]?.questions[currentQuestion]?.question || '')
            formData.append('scenario', scenarios[currentScenario]?.scenario || '')

            try {
              const response = await fetch('http://127.0.0.1:5000/upload_psychometric_video', {
                method: 'POST',
                body: formData,
              })
              
              if (!response.ok) {
                throw new Error('Failed to upload video')
              }
              
              const data = await response.json()
              console.log(`Uploaded video for scenario ${currentScenario + 1}, question ${currentQuestion + 1}. S3 URI: ${data.s3_uri}`)
              chunksRef.current = []
              resolve()
            } catch (error) {
              console.error('Error uploading video:', error)
              resolve()
            }
          } else {
            resolve()
          }
        }
        
        mediaRecorderRef.current!.stop()
      })
    }
    return Promise.resolve()
  }, [assessmentId, scenarios, currentScenario, currentQuestion])

  const saveCurrentResponse = useCallback(async () => {
    if (assessmentId && transcript && scenarios[currentScenario]) {
      try {
        const responseData = {
          assessmentId,
          responseData: {
            [`scenario_${scenarios[currentScenario].scenario_id}`]: {
              scenarioId: scenarios[currentScenario].scenario_id,
              scenario: scenarios[currentScenario].scenario,
              questions: [{
                questionIndex: currentQuestion,
                responseText: transcript,
                questionText: scenarios[currentScenario].questions[currentQuestion]?.question || '',
                points: scenarios[currentScenario].questions[currentQuestion]?.points || 0
              }]
            }
          },
          psyTimeSpent
        }
        const response = await fetch('http://127.0.0.1:5000/save_psychometric_response', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(responseData),
        })
        if (!response.ok) {
          throw new Error('Failed to save response')
        }
        console.log(`Saved response for scenario ${currentScenario + 1}, question ${currentQuestion + 1}:`, responseData)

        await saveCurrentVideo()
      } catch (error) {
        console.error('Error saving response:', error)
      }
    }
  }, [assessmentId, transcript, scenarios, currentScenario, currentQuestion, saveCurrentVideo, psyTimeSpent])

  const handleSubmit = useCallback(async () => {
    if (assessmentId && !isSubmitting) {
      setIsSubmitting(true)
      try {
        await saveCurrentResponse()

        if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => track.stop())
        }
        
        if (recognitionRef.current) {
          recognitionRef.current.stop()
        }
        
        setRecording(false)

        if (psyTimerRef.current) {
          clearInterval(psyTimerRef.current)
          psyTimerRef.current = null
        }
        const endTime = Date.now()
        const totalTimeSpent = Math.floor((endTime - startTimeRef.current) / 1000)
        const response = await fetch('http://127.0.0.1:5000/end_assessment', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ assessmentId, psyTimeSpent: totalTimeSpent }),
        })

        if (!response.ok) {
          throw new Error('Failed to end assessment')
        }

        console.log("Assessment completed and submitted successfully")
        // You can add additional logic here, such as redirecting to a completion page
      } catch (error) {
        console.error('Error submitting assessment:', error)
        setError(error instanceof Error ? error.message : 'An unknown error occurred during submission')
      } finally {
        setIsSubmitting(false)
      }
    }
  }, [assessmentId, isSubmitting, saveCurrentResponse, psyTimeSpent])

  const moveToNextQuestion = useCallback(async () => {
    await saveCurrentResponse()
    
    setTranscript("")
    
    if (currentQuestion < (scenarios[currentScenario]?.questions.length || 0) - 1) {
      setCurrentQuestion(prev => prev + 1)
    } else if (currentScenario < scenarios.length - 1) {
      setCurrentScenario(prev => prev + 1)
      setCurrentQuestion(0)
    } else {
      await handleSubmit()
      return
    }
    
    if (streamRef.current) {
      const mediaRecorder = new MediaRecorder(streamRef.current)
      mediaRecorderRef.current = mediaRecorder
      chunksRef.current = []
      
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data)
        }
      }
      
      mediaRecorder.start()
      setRecording(true)
    }
  }, [saveCurrentResponse, scenarios, currentScenario, currentQuestion, handleSubmit])

  useEffect(() => {
    fetchScenariosAndQuestions()
  }, [fetchScenariosAndQuestions])

  useEffect(() => {
    const handleKeyPress = async (e: KeyboardEvent) => {
      if (e.code === 'Space' && recording && (currentScenario < scenarios.length - 1 || currentQuestion < (scenarios[currentScenario]?.questions.length || 0) - 1)) {
        e.preventDefault()
        await saveCurrentResponse()
        await moveToNextQuestion()
      }
    }
    
    window.addEventListener('keydown', handleKeyPress)
    return () => window.removeEventListener('keydown', handleKeyPress)
  }, [recording, currentScenario, currentQuestion, scenarios, moveToNextQuestion, saveCurrentResponse])

  useEffect(() => {
    if (assessmentStarted) {
      const startTime = Date.now()
      psyTimerRef.current = setInterval(() => {
        const elapsedSeconds = Math.floor((Date.now() - startTime) / 1000)
        setPsyTimeSpent(elapsedSeconds)
      }, 1000)
    }
    return () => {
      if (psyTimerRef.current) {
        clearInterval(psyTimerRef.current)
      }
    }
  }, [assessmentStarted])

  const startAssessment = useCallback(async () => {
    try {
      const response = await fetch('http://127.0.0.1:5000/start_psychometric_assessment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, jobId, compId, department }),
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Failed to start assessment')
      }
      setAssessmentId(data.assessment_id)
      startTimeRef.current = Date.now()

      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
      }

      const mediaRecorder = new MediaRecorder(stream)
      mediaRecorderRef.current = mediaRecorder
      chunksRef.current = []
      
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data)
        }
      }
      
      mediaRecorder.start()
      setRecording(true)

      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
      const recognition = new SpeechRecognition()
      recognition.continuous = true
      recognition.interimResults = true
      recognitionRef.current = recognition
      
      recognition.onstart = () => {
        setIsListening(true)
      }
      
      recognition.onresult = (event: SpeechRecognitionEvent) => {
        let finalTranscript = ''
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript
          if (event.results[i].isFinal) {
            finalTranscript += transcript + ' '
          }
        }
        if (finalTranscript) {
          setTranscript(prev => prev + finalTranscript)
        }
      }
      
      recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        console.error('Speech recognition error:', event.error)
        setIsListening(false)
      }
      
      recognition.start()
      setAssessmentStarted(true)
    } catch (error) {
      console.error('Error starting assessment:', error)
      setError(error instanceof Error ? error.message : 'An unknown error occurred while starting the assessment')
    }
  }, [username, jobId, compId, department])

  const formatTime = (seconds: number) => {
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = seconds % 60
    return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`
  }

  if (isLoading) {
    return <div className="flex justify-center items-center h-screen">Loading...</div>
  }

  if (error) {
    return <div className="flex justify-center items-center h-screen text-red-500">{error}</div>
  }

  if (scenarios.length === 0) {
    return <div className="flex justify-center items-center h-screen">No scenarios available.</div>
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100">
      <div className="max-w-7xl mx-auto p-6">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900">Psychometric Assessment</h1>
          <p className="text-gray-600 mt-2">Job Assessment for {department}</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr,400px] gap-6">
          <div className="space-y-4">
            <Card className="overflow-hidden bg-white shadow-xl">
              <div className="flex items-center justify-between px-4 py-2 bg-gray-900 text-white">
                <div className="flex items-center gap-2">
                  {recording && (
                    <>
                      <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></div>
                      <span>Recording</span>
                    </>
                  )}
                </div>
                <span className="text-sm">{username}</span>
                <Button variant="ghost" size="sm" className="text-white hover:text-white">
                  <MoreHorizontal className="h-5 w-5" />
                </Button>
              </div>
              
              <video
                ref={videoRef}
                autoPlay
                muted
                playsInline
                className="w-full aspect-video object-cover bg-gray-900"
              />
              
              {!assessmentStarted && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                  <Button 
                    onClick={startAssessment}
                    className="bg-orange-400 hover:bg-orange-500 text-white px-8 py-4 text-lg"
                  >
                    Start Assessment
                  </Button>
                </div>
              )}
            </Card>
          </div>

          <Card className="bg-white shadow-xl">
            <div className="p-6 space-y-6">
              <div className="flex items-center justify-between text-sm">
                <div className="font-medium">Scenario {currentScenario + 1}/{scenarios.length}</div>
                <div className="text-gray-500">Job Assessment</div>
              </div>
              
              {scenarios[currentScenario] && (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-sm font-medium text-gray-500">Scenario</h3>
                    <p className="mt-1 text-gray-900">{scenarios[currentScenario].scenario}</p>
                  </div>
                  
                  {scenarios[currentScenario].questions[currentQuestion] && (
                    <div>
                      <h3 className="text-sm font-medium text-gray-500">Question {currentQuestion + 1}/{scenarios[currentScenario].questions.length}</h3>
                      <p className="mt-1 text-gray-900">{scenarios[currentScenario].questions[currentQuestion].question}</p>
                    </div>
                  )}

                  <div>
                    <div className="flex items-center justify-between gap-2 text-sm font-medium text-gray-500">
                      <h3>Your Response</h3>
                      {isListening && (
                        <div className="flex items-center gap-1 text-green-600">
                          <Mic className="w-4 h-4" />
                          <span className="text-xs">Listening...</span>
                        </div>
                      )}
                    </div>
                    <div className="mt-2 p-3 min-h-[150px] bg-gray-50 rounded-lg text-gray-600">
                      {transcript || 'Start speaking to record your response...'}
                    </div>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between text-sm text-gray-500 pt-4 border-t">
                <p>Press spacebar to move to next question</p>
                <p>Total time: {formatTime(psyTimeSpent)}</p>
              </div>

              {currentScenario === scenarios.length - 1 && currentQuestion === scenarios[currentScenario]?.questions.length - 1 && (
                <Button 
                  onClick={handleSubmit}
                  className="w-full bg-green-600 hover:bg-green-700 text-white"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? 'Submitting...' : 'Submit Assessment'}
                </Button>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}