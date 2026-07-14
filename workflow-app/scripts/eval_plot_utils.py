import numpy as np

PROJECT_LABEL_FONTSIZE = 5
PROJECT_LABEL_ROTATION = 90


def project_sort_key(project_id):
    return str(project_id).lower()


def sort_rows_by_project(rows, project_key="project_id"):
    return sorted(rows, key=lambda row: project_sort_key(row[project_key]))


def project_ids_from_rows(rows, project_key="project_id"):
    return [row[project_key] for row in rows]


def style_project_xaxis(ax, project_ids, fontsize=PROJECT_LABEL_FONTSIZE, rotation=PROJECT_LABEL_ROTATION):
    n = len(project_ids)
    if n == 0:
        return

    ax.set_xlim(-0.5, n - 0.5)
    ax.set_xticks(np.arange(n))
    ax.set_xticklabels(
        project_ids,
        rotation=rotation,
        fontsize=fontsize,
        ha="center",
    )
    ax.margins(x=0)
