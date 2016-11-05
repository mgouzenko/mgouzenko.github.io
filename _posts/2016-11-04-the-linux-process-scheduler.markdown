---
layout: post
title:  "The Linux Process Scheduler"
date:   2016-11-04 20:17:34
categories: jekyll update
---

I'm writing this post after TA-ing an operating systems class for two
semesters. Each year, tears begin to flow by the time we get to the infamous
Scheduler Assignment, where students are asked to implement a simple
round-robin scheduler in the Linux kernel. The assignment is known to leave
relatively competent programmers in shambles - bloodshot and disheveled,
screaming profanities at their computer screens as they desperately search for
the bug that is hanging their OS. I don't blame them; the seemingly simple task
of writing a round robin scheduler is complicated by two confounding factors:

  * The Linux scheduler is cryptic as hell and on top of that, very poorly documented.
  * Bugs in scheduler code will cause the OS to go into kernel panic, freezing the system without providing any logs or meaningful error messages.

In this post, I hope to ease students' suffering by addressing the first bullet
point. In particular, I will try to explain how the scheduler's infrastructure
is set up and how one may plug their own scheduler into this infrastructure. Note
that I will NOT explain Linux's CFS algorithm here, nor will I explain
group scheduling. These are implementation details of Linux's scheduling algorithm,
and the main goal here is to understand how to plug in a *new* scheduler.

## A Top Down Approach to Understanding the Scheduler
In my explanation, I'm going to start off treating the scheduler as a black
box. I start by explaining the APIs that the rest of the OS uses to interact
with the scheduler. In the process, I will make gross over-simplifications, and
I will note very clearly when I do so. Little by little, we will delve into the
scheduler's internals, unfolding the truth behind these simplifications. By the
end of this post, you should be able to start tackling the problem of writing
your own working scheduler.

## What is the scheduler?
Linux is a multi-tasking system. At any given time, there are many processes
active at once, but a given CPU can only perform work on behalf of one process
at a time. At a high level, the OS context switches from process to process,
forcing the CPU to perform work on behalf of each one in turn. This switching
occurs quickly enough to create the illusion that all processes are running at
the same time. The scheduler is in charge of coordinating all of this
switching. In particular, the scheduler has two main jobs:

  * It provides an interface to halt the currently running process and switch to a new one.
  * It must indicate to the OS when a new process should be run.

## The Runqueue
Here's the first over-simplification: you can think of the scheduler as a
system that maintains a simple queue of processes in the form of a linked list.
The process at the head of the queue is allowed to run for some "time slice" -
say, 10 milliseconds. After this time slice expires, the process is moved to
the back of the queue, and the next process gets to run on the CPU for the same
time slice.

This linked list of processes waiting to have a go on the CPU is called the
runqueue. Each CPU has its own runqueue, and a given process may appear on only
one CPU's runqueue at a time. Processes CAN migrate between various CPUs'
runqueues, but we'll save this discussion for later.


![Simple Runqueue]({{ site.baseurl }}/assets/simple_runqueue/final_simple_runqueue.png)
<center>Figure 1: An over-simplification of the runqueue</center>
<br/>

Of course, the runqueue is not *actually* a linked list. It's defined in the
kernel as `struct rq`. You can take a peek at this struct's definition
[here](http://lxr.free-electrons.com/source/kernel/sched/sched.h#L581), but I
don't recommend it just yet.


## Switching to a new process
The `schedule()` function is used to halt the currently running process and
switch to a new one. This function invokes `__schedule()` to do most of the real work.
The function is pretty long, but the portion relevant to us is here:

{% highlight c++ %}
static void __sched notrace __schedule(bool preempt)
{
        struct task_struct *prev, *next;
	unsigned long *switch_count;
	struct rq *rq;

	/* CODE OMMITTED */

	next = pick_next_task(rq, prev, cookie);
	clear_tsk_need_resched(prev);
	clear_preempt_need_resched();
	rq->clock_skip_update = 0;

	if (likely(prev != next)) {
		rq->nr_switches++;
		rq->curr = next;
		++*switch_count;

		trace_sched_switch(preempt, prev, next);
		rq = context_switch(rq, prev, next, cookie);
	}
}
{% endhighlight %}

The function `pick_next_task` picks the `task_struct` associated with the
process that should be run next. If we consider t=0 in Figure 1,
`pick_next_task` would return the `task_struct` for Process 2. Then,
`context_switch` switches the CPU's state to that of the next process, so that
it may run.

## How does schedule() get called?
Great, so we've seen that `schedule()` is used to 1) pick the next task and
2) context switch to that task. But, when does this *actually* happen? How
does the kernel know that a process's time slice is up, and that schedule
should be called?

We tackle this question by looking at the function `update_process_times`, shown below.

{% highlight c %}
/*
* Called from the timer interrupt handler to charge one tick to the current
* process.  user_tick is 1 if the tick is user time, 0 for system.
*/
void update_process_times(int user_tick)
{
	struct task_struct *p = current;

	/* Note: this timer irq context must be accounted for as well. */
	account_process_tick(p, user_tick);
	run_local_timers();
	rcu_check_callbacks(user_tick);
#ifdef CONFIG_IRQ_WORK
	if (in_irq())
	irq_work_tick();
#endif
	scheduler_tick();
	run_posix_cpu_timers(p);
}
{% endhighlight %}


This function is called whenever the clock ticks. Notice how `update_process_times`
invokes `scheduler_tick`. In `scheduler_tick`, the scheduler checks to see if the
running process's time has expired. If so, it sets a (over-simplification alert) global
flag called `need_resched`. This indicates to the rest of the kernel that the
`schedule` should be called.

But wait, why the heck can't the scheduler just call `schedule` by itself, from within the timer
interrupt? After all, if the scheduler knows that a process's time has expired, shouldn't it
just context switch right away?

As it turns out, it is not always safe to call schedule. In particular, if the
currently running process is holding a spin lock, it cannot be put to sleep.
(Let me repeat that one more time because people always forget: **you cannot
sleep with a spin lock.** Sleeping with a spin lock will cause the kernel to
deadlock, and will bring you anguish for many hours when you can't figure out
why your process mysteriously froze.)

Thus, when the scheduler sets the `need_resched` flag, it's saying "please
kernel, invoke `schedule` at your earliest convenience, when it's safe to do
so." The kernel keeps a count of how many spin locks the currently running
process has acquired. When that count goes down to 0, the kernel knows that
it's okay to put the process to sleep. So, the kernel checks the `need_resched`
flag in two main places:

  * when returning from an interrupt handler
  * when returning to user-space from a system call

If `need_resched` is `True` and the spinlock count is 0, then the kernel calls `schedule`.
