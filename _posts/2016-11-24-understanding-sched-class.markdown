---
layout: post
title:  "Understanding sched_class"
date:   2016-11-24 20:17:34
categories: jekyll update
series:  "The Linux Scheduler"
---

{% include series.html %}

## Understanding sched_class
I've skipped a bunch of stuff to get here because the scheduler assignment is
due soon. In this section, I will analyze `struct sched_class` and talk
briefly about what each function does. I've reproduced `struct sched_class`
below.

{% highlight c %}
struct sched_class {
	const struct sched_class *next;

	void (*enqueue_task) (struct rq *rq, struct task_struct *p, int flags);
	void (*dequeue_task) (struct rq *rq, struct task_struct *p, int flags);
	void (*yield_task) (struct rq *rq);
	bool (*yield_to_task) (struct rq *rq, struct task_struct *p,
			       bool preempt);

	void (*check_preempt_curr) (struct rq *rq, struct task_struct *p,
				    int flags);

	/*
	 * It is the responsibility of the pick_next_task() method that will
	 * return the next task to call put_prev_task() on the @prev task or
	 * something equivalent.
	 *
	 * May return RETRY_TASK when it finds a higher prio class has runnable
	 * tasks.
	 */
	struct task_struct * (*pick_next_task) (struct rq *rq,
						struct task_struct *prev,
						struct pin_cookie cookie);
	void (*put_prev_task) (struct rq *rq, struct task_struct *p);

#ifdef CONFIG_SMP
	int  (*select_task_rq)(struct task_struct *p, int task_cpu, int sd_flag,
			       int flags);
	void (*migrate_task_rq)(struct task_struct *p);

	void (*task_woken) (struct rq *this_rq, struct task_struct *task);

	void (*set_cpus_allowed)(struct task_struct *p,
				 const struct cpumask *newmask);

	void (*rq_online)(struct rq *rq);
	void (*rq_offline)(struct rq *rq);
#endif

	void (*set_curr_task) (struct rq *rq);
	void (*task_tick) (struct rq *rq, struct task_struct *p, int queued);
	void (*task_fork) (struct task_struct *p);
	void (*task_dead) (struct task_struct *p);

        /*
	 * The switched_from() call is allowed to drop rq->lock, therefore we
	 * cannot assume the switched_from/switched_to pair is serliazed by
	 * rq->lock. They are however serialized by p->pi_lock.
	 */
	void (*switched_from) (struct rq *this_rq, struct task_struct *task);
	void (*switched_to) (struct rq *this_rq, struct task_struct *task);
	void (*prio_changed) (struct rq *this_rq, struct task_struct *task,
			      int oldprio);

	unsigned int (*get_rr_interval) (struct rq *rq,
					 struct task_struct *task);

	void (*update_curr) (struct rq *rq);

#define TASK_SET_GROUP  0
#define TASK_MOVE_GROUP 1

#ifdef CONFIG_FAIR_GROUP_SCHED
	void (*task_change_group) (struct task_struct *p, int type);
#endif
};
{% endhighlight %}

# enqueue_task and dequeue_task
{% highlight c %}
/* Called to enqueue task_struct p on runqueue rq. */
void enqueue_task(struct rq *rq, struct task_struct *p, int flags);

/* Called to dequeue task_struct p from runqueue rq. */
void dequeue_task(struct rq *rq, struct task_struct *p, int flags);
{% endhighlight %}

`enqueue_task` and `dequeue_task` are used to put a task on the runqueue and remove
a task from the runqueue, respectively. Each of these functions are passed the task
to be enqueued/dequeued, as well as the runqueue it should be added/removed
from. In addition, these functions are given a bit vector of flags that
describe *why* enqueue or dequeue is being called. Here are the various flags,
which are described in
[sched.h](http://lxr.free-electrons.com/source/kernel/sched/sched.h#L1181):

{% highlight c %}
/*
* {de,en}queue flags:
*
* DEQUEUE_SLEEP  - task is no longer runnable
* ENQUEUE_WAKEUP - task just became runnable
*
* SAVE/RESTORE - an otherwise spurious dequeue/enqueue, done to ensure tasks
*                are in a known state which allows modification. Such pairs
*                should preserve as much state as possible.
*
* MOVE - paired with SAVE/RESTORE, explicitly does not preserve the location
*        in the runqueue.
*
* ENQUEUE_HEAD      - place at front of runqueue (tail if not specified)
* ENQUEUE_REPLENISH - CBS (replenish runtime and postpone deadline)
* ENQUEUE_MIGRATED  - the task was migrated during wakeup
*
*/
{% endhighlight %}

The `flags` argument can be tested using the bitwise `&` operation. For example,
if the task was just migrated from another CPU, `flags & ENQUEUE_MIGRATED`
evaluates to 1.

These functions are called for a variety of reasons:

  * When a child process is first forked, `enqueue_task` is called
  to put it on a runqueue. When a process exits, `dequeue_task`
  takes it off the runqueue.
  * When a process goes to sleep, `dequeue_task` takes it off the runqueue.
  For example, this happens when the process needs to wait for a lock or IO
  event. When the IO event occurs, or the lock becomes available, the process
  wakes up. It must then be re-enqueued with `enqueue_task`.
  * Process migration - if a process must be migrated from one CPU's
    runqueue to another, it's dequeued from its old runqueue and
    enqueued on a different one using this function.
  * When set_cpus_allowed is called to change the task's processor
    affinity, it may need to be enqueued on a different CPU's runqueue
  * When the priority of a process is boosted to avoid priority inversion.
    In this case, p used to have a low-priority sched_class, but is being
    promoted to a sched_class with high priority. This action occurs in
    rt_mutex_setprio.
  * From `__sched_setscheduler`. If a task's `sched_class` has changed, it's
    dequeued using its old sched_class and enqueued with the new one.

# pick_next_task

{% highlight c %}
/* Pick the task that should be currently running. */
struct task_struct *pick_next_task (struct rq *rq,
				    struct task_struct *prev,
				    struct pin_cookie cookie);
{% endhighlight %}

`pick_next_task` is called by the core scheduler to determine which of rq's
tasks should be running. The name is a bit misleading. This function is not
supposed to return the task that should run *after* the currently running task;
instead, it's supposed to return the `task_struct` that should be running now,
**in this instant.**

The kernel will context switch from the task specified by `prev` to the task
returned by `pick_next_task`.


# put_prev_task

{% highlight c %}
/* Called right before p is going to be taken off the CPU. */
void put_prev_task(struct rq *rq, struct task_struct *p);
{% endhighlight %}

`put_prev_task` is called whenever a task is to be taken off the CPU. The
behavior of this function is up to the specific `sched_class`. Some schedulers
do very little in this function. For example, the realtime scheduler
uses this function as an opportunity to perform simple bookeeping. On the other
hand, CFS's `put_prev_task_fair` needs to do a bit more work. As an
optimization, CFS keeps the currently running task out of its RB tree. It uses
the `put_prev_task` hook as an opportunity to put the currently running task
(that is, the task specified by `p`) back in the RB tree.

The sched_class's `put_prev_task` is called by the function `put_prev_task`, which
is [defined](http://lxr.free-electrons.com/source/kernel/sched/sched.h#L1258) in sched.h.
It seems a bit silly, but the sched_class's `pick_next_task` is expected to call
`put_prev_task` by itself! This is documented in the following comment:

{% highlight c %}
/*
* It is the responsibility of the pick_next_task() method that will
* return the next task to call put_prev_task() on the @prev task or
* something equivalent.
*/
{% endhighlight %}

Note that this was not the case in prior kernels; `put_prev_task` [used to be
called](http://lxr.free-electrons.com/source/kernel/sched/core.c?v=3.11#L2445)
by the core scheduler before it called `pick_next_task`.

# task_tick

{% highlight c %}
/* Called from the timer interrupt handler. p is the currently running task
 * and rq is the runqueue that it's on.
 */
void task_tick(struct rq *rq, struct task_struct *p, int queued);
{% endhighlight %}

This is one of the most important scheduler functions. It is called whenever
a timer interrupt happens, and its job is to perform bookeeping and set the `need_resched`
flag if the currently-running process needs to be preempted:

The `need_resched` flag can be set by the function `resched_curr`,
[found](http://lxr.free-electrons.com/source/kernel/sched/core.c#L481) in
core.c:

{% highlight c %}
/* Mark rq's currently-running task to be rescheduled. */
void resched_curr(struct rq *rq)
{% endhighlight %}

With SMP, there's a `need_resched` flag for every CPU. Thus, `resched_curr`
might involve sending an APIC inter-processor interrupt to another processor
(you don't want to go here). The takeway is that you should just use
`resched_curr` to set `need_resched`, and don't try to do this yourself.

Note: in prior kernel versions, `resched_curr` used to be called `resched_task`.


# select_task_rq

{% highlight c %}
/* Returns an integer corresponding to the CPU that this task should run on */
int select_task_rq(struct task_struct *p, int task_cpu, int sd_flag, int flags);
{% endhighlight%}

The core scheduler invokes this function to figure out which CPU to assign a task
to. This is used for distributing processes accross multiple CPUs; the core
scheduler will call enqueue_task, passing the runqueue corresponding to the CPU
that is returned by this function. CPU assignment obviously occurs when a
process is first forked, but CPU reassignment can happen for a large variety of reasons.
Here are some instances where `select_task_rq` is called:

  * When a process is first forked.
  * When a task is woken up after having gone to sleep.
  * In response to any of the syscalls in the execv family. This is an
  optimization, since it doesn't hurt the cache to migrate a process that's
  about to call exec.
  * And many more places...

You can check *why* `select_task_rq` was called by looking at `sd_flag`. The possible
values of the flag are enumerated in `sched.h`:

{% highlight c %}
#define SD_LOAD_BALANCE         0x0001  /* Do load balancing on this domain. */
#define SD_BALANCE_NEWIDLE      0x0002  /* Balance when about to become idle */
#define SD_BALANCE_EXEC         0x0004  /* Balance on exec */
#define SD_BALANCE_FORK         0x0008  /* Balance on fork, clone */
#define SD_BALANCE_WAKE         0x0010  /* Balance on wakeup */
#define SD_WAKE_AFFINE          0x0020  /* Wake task to waking CPU */
#define SD_SHARE_CPUCAPACITY    0x0080  /* Domain members share cpu power */
#define SD_SHARE_POWERDOMAIN    0x0100  /* Domain members share power domain */
#define SD_SHARE_PKG_RESOURCES  0x0200  /* Domain members share cpu pkg resources */
#define SD_SERIALIZE            0x0400  /* Only a single load balancing instance */
#define SD_ASYM_PACKING         0x0800  /* Place busy groups earlier in the domain */
#define SD_PREFER_SIBLING       0x1000  /* Prefer to place tasks in a sibling domain */
#define SD_OVERLAP              0x2000  /* sched_domains of this level overlap */
#define SD_NUMA                 0x4000  /* cross-node balancing */
{% endhighlight %}

For instance, `sd_flag == SD_BALANCE_FORK` whenever `select_task_rq` is called to
determine the CPU of a newly forked task.

Note that `select_task_rq` should return a CPU that `p` is allowed to run on.
Each `task_struct` has a
[member](http://lxr.free-electrons.com/source/include/linux/sched.h#L1499)
called `cpus_allowed`, of type `cpumask_t`. This member represents the task's
CPU affinity - i.e. which CPUs it can run on. It's possible to iterate over these
CPUs with the macro `for_each_cpu`, defined [here](http://lxr.free-electrons.com/source/include/linux/cpumask.h#L216).

# set_curr_task
{% highlight c %}
/* Called when a task changes its scheduling class or changes its task group. */
void set_curr_task(struct rq *rq);
{% endhighlight %}
