import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import { TOOLKIT_ROOT } from '@/paths';
import sqlite3 from 'sqlite3';
import { promisify } from 'util';

const prisma = new PrismaClient();

interface ImportedJob {
  id: string;
  name: string;
  gpu_ids: string;
  job_config: string;
  created_at: string;
  updated_at: string;
  status: string;
  stop: number;
  step: number;
  info: string;
  speed_string: string;
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('database') as File;

    if (!file) {
      return NextResponse.json({ error: 'No database file provided' }, { status: 400 });
    }

    // Validate file size (max 100MB)
    if (file.size > 100 * 1024 * 1024) {
      return NextResponse.json({ error: 'File too large. Maximum size is 100MB.' }, { status: 400 });
    }

    // Validate file type
    if (!file.name.endsWith('.db') && !file.name.endsWith('.sqlite') && !file.name.endsWith('.sqlite3')) {
      return NextResponse.json({ error: 'Invalid file type. Please select a SQLite database file (.db, .sqlite, or .sqlite3).' }, { status: 400 });
    }

    // Save uploaded file temporarily
    const tempDir = path.join(TOOLKIT_ROOT, 'temp');
    if (!fs.existsSync(tempDir)) {
      try {
        fs.mkdirSync(tempDir, { recursive: true });
      } catch (error) {
        return NextResponse.json({ error: 'Unable to create temporary directory for import' }, { status: 500 });
      }
    }

    const tempFilePath = path.join(tempDir, `import_${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`);
    
    try {
      const arrayBuffer = await file.arrayBuffer();
      fs.writeFileSync(tempFilePath, Buffer.from(arrayBuffer));
    } catch (error) {
      return NextResponse.json({ error: 'Failed to save uploaded file' }, { status: 500 });
    }

    try {
      // Validate and import from the database
      const result = await importJobsFromDatabase(tempFilePath);
      
      // Clean up temp file
      fs.unlinkSync(tempFilePath);
      
      return NextResponse.json(result);
    } catch (error: any) {
      // Clean up temp file on error
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
      throw error;
    }
  } catch (error: any) {
    console.error('Error importing jobs:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to import jobs' },
      { status: 500 }
    );
  }
}

async function importJobsFromDatabase(dbPath: string) {
  return new Promise<{ success: boolean; imported: number; skipped: number; message: string }>((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
      if (err) {
        reject(new Error('Invalid database file or corrupted database. Please ensure this is a valid AI Toolkit database.'));
        return;
      }

      // Validate database structure - check for Job table with expected columns
      db.get(`PRAGMA table_info(Job)`, async (err, rows) => {
        if (err) {
          db.close();
          reject(new Error('Failed to read database structure'));
          return;
        }

        // Check if Job table exists
        db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='Job'", async (err, row) => {
          if (err || !row) {
            db.close();
            reject(new Error('Database does not contain a valid Job table. This may not be an AI Toolkit database.'));
            return;
          }

          // Get all jobs from the imported database
          db.all("SELECT * FROM Job", async (err, jobs: ImportedJob[]) => {
            if (err) {
              db.close();
              reject(new Error('Failed to read jobs from database: ' + err.message));
              return;
            }

            db.close();

            if (!jobs || jobs.length === 0) {
              resolve({
                success: true,
                imported: 0,
                skipped: 0,
                message: 'No jobs found in the database to import.'
              });
              return;
            }

            let imported = 0;
            let skipped = 0;
            const errors: string[] = [];

            for (const job of jobs) {
              try {
                // Validate required fields
                if (!job.name || !job.job_config) {
                  skipped++;
                  errors.push(`Job with ID ${job.id} is missing required fields`);
                  continue;
                }

                // Check if job with same name already exists
                const existingJob = await prisma.job.findFirst({
                  where: { name: job.name }
                });

                if (existingJob) {
                  skipped++;
                  continue;
                }

                // Validate job_config is valid JSON
                try {
                  JSON.parse(job.job_config);
                } catch {
                  skipped++;
                  errors.push(`Job "${job.name}" has invalid configuration data`);
                  continue;
                }

                // Import the job
                await prisma.job.create({
                  data: {
                    id: job.id,
                    name: job.name,
                    gpu_ids: job.gpu_ids || '0',
                    job_config: job.job_config,
                    created_at: new Date(job.created_at),
                    updated_at: new Date(job.updated_at),
                    status: job.status || 'stopped',
                    stop: job.stop === 1,
                    step: job.step || 0,
                    info: job.info || '',
                    speed_string: job.speed_string || '',
                  }
                });
                imported++;
              } catch (error: any) {
                // If there's a unique constraint error on ID, generate a new ID
                if (error.code === 'P2002' && error.meta?.target?.includes('id')) {
                  try {
                    await prisma.job.create({
                      data: {
                        name: job.name,
                        gpu_ids: job.gpu_ids || '0',
                        job_config: job.job_config,
                        created_at: new Date(job.created_at),
                        updated_at: new Date(job.updated_at),
                        status: job.status || 'stopped',
                        stop: job.stop === 1,
                        step: job.step || 0,
                        info: job.info || '',
                        speed_string: job.speed_string || '',
                      }
                    });
                    imported++;
                  } catch {
                    skipped++;
                    errors.push(`Failed to import job "${job.name}" due to conflicts`);
                  }
                } else {
                  skipped++;
                  errors.push(`Failed to import job "${job.name}": ${error.message}`);
                }
              }
            }

            let message = `Successfully imported ${imported} jobs.`;
            if (skipped > 0) {
              message += ` ${skipped} jobs were skipped (duplicate names or errors).`;
            }
            if (errors.length > 0 && errors.length <= 3) {
              message += ` Errors: ${errors.join(', ')}`;
            } else if (errors.length > 3) {
              message += ` Multiple errors occurred during import.`;
            }

            resolve({
              success: true,
              imported,
              skipped,
              message
            });
          });
        });
      });
    });
  });
} 