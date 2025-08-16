import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { getTrainingFolder } from '@/server/settings';
import path from 'path';
import fs from 'fs';

const prisma = new PrismaClient();

export async function GET(request: NextRequest, { params }: { params: { jobID: string } }) {
  const { jobID } = await params;

  const job = await prisma.job.findUnique({
    where: { id: jobID },
  });

  if (!job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }

  const trainingRoot = await getTrainingFolder();
  const trainingFolder = path.join(trainingRoot, job.name);

  if (fs.existsSync(trainingFolder)) {
    fs.rmdirSync(trainingFolder, { recursive: true });
  }

  // Remove job from queue if it exists
  await prisma.queue.deleteMany({
    where: { job_id: jobID },
  });

  await prisma.job.delete({
    where: { id: jobID },
  });

  return NextResponse.json(job);
}
