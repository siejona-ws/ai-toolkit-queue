class CronWorker {
  interval: number;
  is_running: boolean;
  intervalId: NodeJS.Timeout;
  constructor() {
    this.interval = 5000; // Check every 5 seconds
    this.is_running = false;
    this.intervalId = setInterval(() => {
      this.run();
    }, this.interval);
  }
  async run() {
    if (this.is_running) {
      return;
    }
    this.is_running = true;
    try {
      // Loop logic here
      await this.loop();
    } catch (error) {
      console.error('Error in cron worker loop:', error);
    }
    this.is_running = false;
  }

  async loop() {
    try {
      // Import here to avoid circular dependencies
      const { PrismaClient } = await import('@prisma/client');
      
      const prisma = new PrismaClient();
      
      try {
        // Check if job queueing is enabled by reading directly from database
        const queueingSetting = await prisma.settings.findFirst({
          where: { key: 'JOB_QUEUEING' }
        });
        
        const isQueueingEnabled = queueingSetting?.value === 'true';
        
        if (!isQueueingEnabled) {
          return; // Don't process queue if queueing is disabled
        }

        // Check if there are any running jobs
        const runningJobs = await prisma.job.findMany({
          where: { status: 'running' },
        });

        if (runningJobs.length > 0) {
          return; // Don't start new jobs if there are already running jobs
        }

        // Get the next job in the queue
        const nextQueueItem = await prisma.queue.findFirst({
          where: { status: 'waiting' },
          orderBy: { created_at: 'asc' },
        });

        if (!nextQueueItem) {
          return; // No jobs in queue
        }

        // Get the job details
        const job = await prisma.job.findUnique({
          where: { id: nextQueueItem.job_id },
        });

        if (!job) {
          // Job not found, remove from queue
          await prisma.queue.delete({
            where: { id: nextQueueItem.id },
          });
          return;
        }

        // Check if the job is still in a queueable state
        if (!['queued', 'stopped', 'error'].includes(job.status)) {
          // Job is not in a valid state to be started, remove from queue
          await prisma.queue.delete({
            where: { id: nextQueueItem.id },
          });
          return;
        }

        // Remove the job from the queue
        await prisma.queue.delete({
          where: { id: nextQueueItem.id },
        });

        // Start the job by making a request to the start endpoint
        console.log(`Starting queued job: ${job.name} (${job.id})`);
        
        // Determine the correct port based on environment
        const isDevelopment = process.env.NODE_ENV !== 'production';
        const port = isDevelopment ? 3000 : 8675;
        const baseUrl = `http://localhost:${port}`;
        
        // Use fetch to call the start endpoint
        try {
          const response = await fetch(`${baseUrl}/api/jobs/${job.id}/start`, {
            method: 'GET',
          });
          
          if (!response.ok) {
            console.error(`Failed to start queued job ${job.id}: ${response.statusText}`);
            // Update job status to error
            await prisma.job.update({
              where: { id: job.id },
              data: {
                status: 'error',
                info: `Failed to start queued job: ${response.statusText}`,
              },
            });
          }
        } catch (error) {
          console.error(`Error starting queued job ${job.id}:`, error);
          // Update job status to error
          await prisma.job.update({
            where: { id: job.id },
            data: {
              status: 'error',
              info: `Error starting queued job: ${error}`,
            },
          });
        }
      } finally {
        await prisma.$disconnect();
      }
    } catch (error) {
      console.error('Error in cron worker loop:', error);
    }
  }
}

// it automatically starts the loop
const cronWorker = new CronWorker();
console.log('Cron worker started with interval:', cronWorker.interval, 'ms');
