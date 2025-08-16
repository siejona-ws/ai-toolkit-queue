'use client';

import { useEffect, useState } from 'react';
import useSettings from '@/hooks/useSettings';
import { TopBar, MainContent } from '@/components/layout';
import { apiClient } from '@/utils/api';

export default function Settings() {
  const { settings, setSettings } = useSettings();
  const [status, setStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const [importMessage, setImportMessage] = useState<string>('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('saving');

    apiClient
      .post('/api/settings', settings)
      .then(() => {
        setStatus('success');
      })
      .catch(error => {
        console.error('Error saving settings:', error);
        setStatus('error');
      })
      .finally(() => {
        setTimeout(() => setStatus('idle'), 2000);
      });
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setSettings(prev => ({ ...prev, [name]: value }));
  };

  const handleCheckboxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, checked } = e.target;
    setSettings(prev => ({ ...prev, [name]: checked }));
  };

  const handleImportJobs = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setStatus('saving');
    setImportMessage('');
    
    const formData = new FormData();
    formData.append('database', file);

    try {
      const response = await apiClient.post('/api/jobs/import', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
      
      if (response.data.success) {
        setStatus('success');
        setImportMessage(response.data.message);
        // Reset the file input
        e.target.value = '';
      } else {
        throw new Error(response.data.error || 'Import failed');
      }
    } catch (error: any) {
      console.error('Error importing jobs:', error);
      setStatus('error');
      setImportMessage(error.response?.data?.error || error.message || 'Failed to import jobs');
    } finally {
      setTimeout(() => {
        setStatus('idle');
        setImportMessage('');
      }, 5000);
    }
  };

  return (
    <>
      <TopBar>
        <div>
          <h1 className="text-lg">Settings</h1>
        </div>
        <div className="flex-1"></div>
      </TopBar>
      <MainContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div>
              <div className="space-y-4">
                <div>
                  <label htmlFor="HF_TOKEN" className="block text-sm font-medium mb-2">
                    Hugging Face Token
                    <div className="text-gray-500 text-sm ml-1">
                      Create a Read token on{' '}
                      <a href="https://huggingface.co/settings/tokens" target="_blank" rel="noreferrer">
                        {' '}
                        Huggingface
                      </a>{' '}
                      if you need to access gated/private models.
                    </div>
                  </label>
                  <input
                    type="password"
                    id="HF_TOKEN"
                    name="HF_TOKEN"
                    value={settings.HF_TOKEN}
                    onChange={handleChange}
                    className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg focus:ring-2 focus:ring-gray-600 focus:border-transparent"
                    placeholder="Enter your Hugging Face token"
                  />
                </div>

                <div>
                  <label htmlFor="TRAINING_FOLDER" className="block text-sm font-medium mb-2">
                    Training Folder Path
                    <div className="text-gray-500 text-sm ml-1">
                      We will store your training information here. Must be an absolute path. If blank, it will default
                      to the output folder in the project root.
                    </div>
                  </label>
                  <input
                    type="text"
                    id="TRAINING_FOLDER"
                    name="TRAINING_FOLDER"
                    value={settings.TRAINING_FOLDER}
                    onChange={handleChange}
                    className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg focus:ring-2 focus:ring-gray-600 focus:border-transparent"
                    placeholder="Enter training folder path"
                  />
                </div>

                <div>
                  <label htmlFor="DATASETS_FOLDER" className="block text-sm font-medium mb-2">
                    Dataset Folder Path
                    <div className="text-gray-500 text-sm ml-1">
                      Where we store and find your datasets.{' '}
                      <span className="text-orange-800">
                        Warning: This software may modify datasets so it is recommended you keep a backup somewhere else
                        or have a dedicated folder for this software.
                      </span>
                    </div>
                  </label>
                  <input
                    type="text"
                    id="DATASETS_FOLDER"
                    name="DATASETS_FOLDER"
                    value={settings.DATASETS_FOLDER}
                    onChange={handleChange}
                    className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg focus:ring-2 focus:ring-gray-600 focus:border-transparent"
                    placeholder="Enter datasets folder path"
                  />
                </div>
                
                <div>
                  <label htmlFor="JOB_QUEUEING" className="block text-sm font-medium mb-2">
                    Job Queueing
                    <div className="text-gray-500 text-sm ml-1">
                      Enable to run jobs one after another (sequentially). Disable to run jobs at the same time (parallel).
                    </div>
                  </label>
                  <input
                    type="checkbox"
                    id="JOB_QUEUEING"
                    name="JOB_QUEUEING"
                    checked={!!settings.JOB_QUEUEING}
                    onChange={handleCheckboxChange}
                    className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                  />
                </div>
              </div>
            </div>
            
            <div>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-2">
                    Import Jobs
                    <div className="text-gray-500 text-sm ml-1">
                      Import jobs from another AI Toolkit database. Select an aitk_db.db file from another instance.
                      <span className="text-orange-800 block mt-1">
                        Warning: Jobs with the same name will be skipped to avoid conflicts.
                      </span>
                      <span className="text-blue-600 block mt-1">
                        Note: Imported jobs will retain their original status and can be continued locally.
                      </span>
                    </div>
                  </label>
                  <input
                    type="file"
                    accept=".db,.sqlite,.sqlite3"
                    onChange={handleImportJobs}
                    disabled={status === 'saving'}
                    className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg focus:ring-2 focus:ring-gray-600 focus:border-transparent file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-gray-600 file:text-gray-200 hover:file:bg-gray-500 disabled:opacity-50"
                  />
                </div>
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={status === 'saving'}
            className="w-full px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {status === 'saving' ? 'Saving...' : 'Save Settings'}
          </button>

          {status === 'success' && <p className="text-green-500 text-center">Settings saved successfully!</p>}
          {status === 'error' && <p className="text-red-500 text-center">Error saving settings. Please try again.</p>}
          
          {/* Import feedback */}
          {importMessage && (
            <div className={`text-center p-3 rounded-lg ${
              status === 'success' ? 'bg-green-500/10 text-green-500' : 
              status === 'error' ? 'bg-red-500/10 text-red-500' : 
              'bg-blue-500/10 text-blue-500'
            }`}>
              {status === 'saving' && 'Importing jobs...'}
              {status !== 'saving' && importMessage}
            </div>
          )}
        </form>
      </MainContent>
    </>
  );
}
